# Mercado Libre — mensajes post-venta en la Bandeja

El canal `mercado_libre` ingiere los **mensajes post-venta** de tu cuenta
vendedora (los chats privados que los compradores abren desde una orden/compra)
y deja responderlos desde la Bandeja, con el mismo flujo que WhatsApp o
Instagram.

- **Apagado por defecto** (ADR-001): se enciende con `CHANNELS`.
- **Sin ventana de 24 h**: la conversación vive mientras la orden esté activa.
- **Límite de 350 caracteres** por mensaje (Máximo que impone la API oficial).
- **Sin adjuntos salientes** por ahora (solo texto).
- **Un comprador = un contacto; un pack (orden) = un hilo** en la Bandeja.
- El poller corre cada 3 minutos dentro del proceso (sin webhooks).

## 1. Crear la aplicación de desarrollador

1. Entra a [developers.mercadolibre.com](https://developers.mercadolibre.com)
   (o el portal de tu país: `developers.mercadolibre.com.ar`, `.com.mx`, etc.)
   e inicia sesión con la **misma cuenta vendedora** que quieres conectar.
2. Crea una aplicación:
   - Tipo: **Aplicación propia** (no la de marketplace para terceros).
   - Nombre libre (p. ej. "Zorro Tech").
   - Plataforma: **Web application**.
3. En la configuración de la app, registra un **redirect URI** (aunque usemos
   el patrón de pegar tokens, ML lo exige para crear la app):
   ```
   https://<tu-dominio-del-crm>/api/settings/mercado-libre
   ```
   Usa el dominio real de tu despliegue (Coolify o Caddy). Si aún no tienes
   dominio, un placeholder https válido sirve para crearla; el CRM no usa el
   callback.
4. Anota el **Client ID** y el **Client Secret** de la app.

## 2. Permisos (scopes)

La app necesita el acceso de mensajería post-venta. En la pestaña de
**Permisos** (o al autorizarla), asegúrate de incluir el scope de mensajería:

- `offline_access` — para obtener y usar **refresh tokens** (obligatorio: el
  CRM renueva el access token solo).
- Scope de mensajes post-venta de la Messaging API (`/marketplace/messages`).
  El nombre exacto aparece en el portal de la app bajo "Mensajes" /
  "Post-venta"; actívalo para tu usuario vendedor.

> Nota: las cuentas vendedoras en el modelo "Model 6" tienen bloqueado el
> acceso a esta API (403). Si Mercado Libre responde 403 al conectar, revisa
> con soporte de ML el modelo de acceso de tu cuenta.

## 3. Obtener el Refresh Token

El CRM usa el flujo de **pegar credenciales** (mismo patrón que Google
Business): no maneja el callback OAuth.

1. Con tu app creada, arma la URL de autorización (reemplaza `APP_ID` y
   `TU_REDIRECT`):
   ```
   https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=APP_ID&redirect_uri=TU_REDIRECT
   ```
   (En `.com.ar` el host es `auth.mercadolibre.com.ar`, etc.)
2. Abre la URL, inicia sesión con la cuenta vendedora y acepta los permisos.
   ML redirige a tu redirect con un `?code=...`.
3. Intercambia el code por tokens (desde tu máquina o Postman):
   ```bash
   curl -X POST https://api.mercadolibre.com/oauth/token \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'grant_type=authorization_code' \
     -d 'client_id=APP_ID' \
     -d 'client_secret=CLIENT_SECRET' \
     -d 'code=CODE' \
     -d 'redirect_uri=TU_REDIRECT'
   ```
   La respuesta trae `access_token`, `refresh_token` e `expires_in`.
4. El **refresh_token** es el que pegas en el CRM (el access token es de
   corta vida y el CRM lo renueva solo).

## 4. Conectar en el CRM

1. Enciende el canal en las variables del despliegue:
   ```
   CHANNELS=whatsapp,mercado_libre
   ```
   (Conserva los canales que ya usabas; solo agrega `mercado_libre`.)
2. Reinicia el contenedor para que aplique la migración `0054` y la nueva
   bandera.
3. Ve a **Configuración → Conexiones → Mercado Libre** (o
   `/settings/mercado-libre`) y pega:
   - **Client ID** de la app
   - **Client Secret**
   - **Refresh Token** obtenido en el paso 3.4
4. Pulsa **Guardar y verificar**: el CRM refresca el token, identifica la
   cuenta vendedora (`/users/me`) y prueba la lista de conversaciones sin
   leer. Si todo sale bien, verás el vendedor y cuántos chats hay pendientes.

## 5. Cómo funciona en el día a día

- El poller (cada 3 minutos) trae los packs con mensajes sin leer, ingerme
  los mensajes del **comprador** en la Bandeja (contacto `ml:<user_id>`, hilo
  por pack) y respeta la idempotencia por el id del mensaje de la API.
- Responder desde la Bandeja publica el mensaje en el pack vía
  `POST /marketplace/messages/packs/{packId}`.
- Mercado Libre limita la mensajería: si el vendedor ya respondió y el
  comprador no ha contestado, un segundo envío puede ser rechazado (403). El
  error aparece en el hilo; espera la respuesta del comprador.
- Los mensajes salientes se persisten con estado `sent` al ser aceptados (sin
  acuses de entrega).
- El agente de IA puede contestar en estos hilos (es un chat privado); puedes
  apagarlo por conversación desde la Bandeja como en cualquier canal.

## 6. Troubleshooting

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| 422 al guardar | Client ID/Secret o refresh token incorrectos | Verifica el code exchange del paso 3; regenera el refresh token |
| 403 al conectar o al enviar | Cuenta "Model 6" o scope de mensajes no activo | Activa el permiso de mensajería en la app; revisa el modelo de acceso de la cuenta |
| "reconnect_required" | ML rotó o revocó el refresh token | Vuelve a pegar uno nuevo en Configuración |
| Llegan pero no se ven mensajes | El poller está apagado o `CHANNELS` no incluye `mercado_libre` | Revisa `CHANNELS` y los logs del contenedor (`[mercado-libre]`) |
| "no se pueden enviar adjuntos" | Capacidad declarada `outboundMedia: false` | Manda texto; los adjuntos salientes no están implementados |

## 7. Seguridad

- Client Secret, Refresh Token y Access Token se guardan **cifrados**
  (AES-256-GCM) en `marketplace_credentials`; jamás se muestran completos en
  la UI (solo los últimos 4 del secret).
- La tabla multi-tenant lleva `organization_id` y todas las queries pasan por
  `scoped()`.
