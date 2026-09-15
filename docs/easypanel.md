# Despliegue de LUMARK en EasyPanel

## 1. PostgreSQL

En el proyecto de EasyPanel, crea un servicio PostgreSQL 16 con almacenamiento
persistente. Copia su URL de conexión interna para usarla como `DATABASE_URL`.
Usa el host, usuario, contraseña y nombre de base que proporciona EasyPanel.

GitHub contiene el esquema y las migraciones, no los registros de la base local.
Para conservar usuarios, contactos e historial existentes, restaura una copia
privada de PostgreSQL antes de iniciar la app. Conserva también la `ENCRYPTION_KEY`
original para poder descifrar las credenciales migradas y los secretos de
autenticación/webhooks si deseas mantener las conexiones existentes.

## 2. Aplicación

- Crea un servicio **App** conectado a GitHub.
- Repositorio: `demiansoberanes7-stack/crm-lumarketing`.
- Rama: `main`.
- Contexto: raíz del repositorio.
- Método de compilación: **Dockerfile**, archivo `Dockerfile`.
- Puerto interno del dominio: **3000**.
- Usa el comando de inicio definido en el Dockerfile.

El Dockerfile incluye frontend y backend. Al arrancar aplica las migraciones
pendientes y luego inicia Next.js. PostgreSQL debe existir y ser accesible;
las migraciones crean las tablas, no el servidor de base de datos.
EasyPanel proporciona el proxy HTTPS; este método no requiere iniciar Caddy.

## 3. Variables de entorno del servicio App

```dotenv
NODE_ENV=production
APP_BASE_URL=https://DOMINIO-PUBLICO-DEL-CRM
DATABASE_URL=URL-INTERNA-DE-POSTGRESQL-DE-EASYPANEL
BETTER_AUTH_SECRET=REEMPLAZAR
ENCRYPTION_KEY=REEMPLAZAR
META_WEBHOOK_VERIFY_TOKEN=REEMPLAZAR
CHANNELS=whatsapp,instagram,messenger
MEDIA_DIR=/data/media
```

Para una instalación nueva, genera los secretos por separado:

```bash
openssl rand -base64 32  # BETTER_AUTH_SECRET
openssl rand -base64 32  # ENCRYPTION_KEY (32 bytes en base64)
openssl rand -hex 32    # META_WEBHOOK_VERIFY_TOKEN
```

Configúralos directamente en EasyPanel. Consulta `.env.example` para variables
opcionales. Para configurar IA mediante entorno, usa `OPENROUTER_API_TOKEN` y
`OPENROUTER_MODEL`.

## 4. Archivos persistentes y dominio

Monta un volumen persistente en `/data/media`, con permisos de escritura para
el usuario `lumark` del contenedor. Conserva ese volumen y el de PostgreSQL entre
despliegues. Configura el dominio HTTPS y usa exactamente esa URL en
`APP_BASE_URL`.

## 5. Verificación y WAHA

1. Despliega y comprueba los logs de migraciones e inicio.
2. Abre `https://DOMINIO-PUBLICO-DEL-CRM/api/health`.
3. En una base nueva, registra el primer usuario. Si restauraste una copia,
   utiliza tu usuario existente.
4. En Ajustes → WAHA, guarda URL del servidor, API key y sesión.
5. Selecciona **WAHA** como proveedor activo de WhatsApp.
6. Escanea el QR y comprueba que la sesión indique `WORKING`.
7. Si la sesión WAHA ya existía, actualiza manualmente sus webhooks con la URL
   pública que muestra el CRM y estos eventos: `message.any`, `message.ack`,
   `session.status`. El registro automático solo ocurre al crear una sesión
   nueva desde el CRM.
8. Envía un mensaje desde otro número y verifica recepción y respuesta en Bandeja.

El webhook debe apuntar al dominio público del CRM, nunca a `localhost`.
