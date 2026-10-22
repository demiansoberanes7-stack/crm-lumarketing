# Deuda técnica — Zorro Tech

> Inventario de código muerto, funcionalidad no operativa y bugs detectados durante la auditoría
> sobre el commit base `5ce91e2`. Cada hallazgo está referenciado a `archivo:línea`.
> Este documento se actualiza en cada fase del proyecto.
> **Se añade la §6 el 2026-10-19** con el resultado de la auditoría de seguridad y
> operatividad (commits `1436d95` + `53f38c0`, ya en producción) y la deuda que esa pasada
> destapó al verificar la documentación. Las secciones 1-5 siguen vigentes tal cual.

Leyenda de severidad: **Bug** (comportamiento incorrecto) · **Muerto** (código no usado) ·
**Inerte** (esquema/entidad sin productores) · **Divergencia** (dos implementaciones del mismo cálculo).

---

## 1. Bugs

### B1 — `queryCommercial` ignora sus filtros · **Bug**
`src/server/commercial/query.ts:18-26` declara `channelId`, `campaignId` y `service`, pero solo usa
`filters.period` (`query.ts:68`). Los filtros de canal, campaña y servicio **no tienen efecto**:
el usuario puede filtrar y obtiene siempre el total de la organización.

### B2 — `/api/analytics/dashboard` devuelve siempre vacío · **Bug (contrato engañoso)**
`src/app/api/analytics/dashboard/route.ts:61-63` inicializa `metrics`, `campaigns` y `chartData`
como arreglos vacíos y nunca los llena (`route.ts:85`). El tipo `DashboardData` (`route.ts:20-26`)
promete datos que jamás llegan. Su único consumidor (`analytics-client.tsx`) está muerto (ver M2).

### B3 — Estado de tarea inconsistente (`pendiente` vs `no_empezado`) · **Bug**
`projectTask.estado` tiene default `"pendiente"` (`schema.ts:1145-1147`) pero `createTask` escribe
`"no_empezado"` (`projects/service.ts:277`). La UI tiene que contar ambos por separado
(`project-detail.tsx:221`). Dos valores para el mismo hecho.

### B4 — `expense.proveedor` es texto libre, no FK · **Bug (integridad)**
`schema.ts:1404` guarda `proveedor` como `varchar` libre mientras existe la tabla `supplier`
(`schema.ts:1546+`). Imposible cruzar gasto ↔ proveedor de forma fiable.

### B5 — Doble agregación de campañas · **Divergencia**
`src/server/ads/query.ts:103-127` (Meta) y `src/server/commercial/query.ts` calculan métricas de
campaña por separado, con ROAS/ROMI fijados a `unavailable("pending")` (`commercial/query.ts:395-396`).
Riesgo de fórmulas divergentes entre pantallas.

### B6 — Dashboard y catálogo de métricas divergen · **Divergencia**
`src/server/dashboard/query.ts` reimplementa en SQL KPIs que ya están declarados en
`src/server/metrics/catalog.ts` y calculados en `src/server/metrics/compute.ts`. La misma métrica
tiene dos definiciones que pueden separarse con el tiempo.

---

## 2. Código muerto (nunca importado / nunca invocado)

| Id | Elemento | Evidencia |
|---|---|---|
| M1 | `createChargeFromQuote` (crea cuenta por cobrar desde cotización, idempotente) | Única aparición = su definición (`finances/service.ts:256`); **cero llamadas** |
| M2 | `src/components/commercial/commercial-hub.tsx` (10 pestañas ya construidas) | 0 imports en `src/` |
| M3 | `src/components/analytics/analytics-client.tsx` | 0 imports; la página `/analytics` redirige (`analytics/page.tsx:7-9`) |
| M4 | `src/components/dashboard/payments-section.tsx` | 0 imports |
| M5 | `src/components/dashboard/expenses-section.tsx` | 0 imports |
| M6 | `GOOGLE_SCOPE` export en el conector Google | Único uso = su definición (`agenda/connectors/google.ts:37`) |

> Decisión de Fase H/G: **revivir** M2–M5 en vez de reescribir UI (ver plan). M1 se **cablea** en P1.

---

## 3. Esquema inerte (definido, sin productores de datos)

| Tabla | Estado | Se lee en | Falta |
|---|---|---|---|
| `attribution_event` (`schema.ts:1851-1906`) | Inerte | dashboard/commercial | Escritores first/last touch + UTMs |
| `ad_set` (`schema.ts:1780-1800`) | Inerte | nadie | Sync de estructura de anuncios |
| `ad_creative` (`schema.ts:1803-1826`) | Inerte | nadie | Sync de creatividades |
| `offer` (`schema.ts:1829-1848`) | Inerte | experiment | CRUD/rutas |
| `sync_state` (`schema.ts:1982-2003`) | Inerte | nadie | Uso en pollers (Meta/Google Ads) |
| `experiment`/`experiment_variant`/`experiment_observation` (`schema.ts:2006-2110`) | Inerte | commercial (nota) | Rutas + UI + captura de observaciones |
| `qualification_criteria` (`schema.ts:2310-2325`) | Inerte | nadie | La tabla entera: sin ruta, sin pantalla, sin lector |
| `loss_reason_catalog` (`schema.ts:2327+`) | Media inerte | nadie | `on-signup.ts:94-101` la SIEMBRA por negocio y nadie la lee: el diálogo de pérdida usa la constante `LOSS_REASON_LABEL` (`lib/types.ts:132`) y el análisis usa `lib/loss-reason.ts` |
| `google_ads_metric` (`schema.ts:2124`) | Bucle cerrado | su propia ruta | `POST /api/google-ads/metrics` escribe y `GET` lee, pero ningún panel ni Copiloto consume esa tabla (Reportes lee `meta_ads`) |

Columnas muertas confirmadas por inspección (definidas, sin escritor o sin lector):
`email_account.from_name` / `.signature` / `.daily_limit` (`schema.ts:1599,1614,1615` — el
envío usa `emailAddress`), `ai_model`, `lead.qualified_at`/`.qualification_data`,
`message.provider_account`, `project.next_meeting_at`, `outbound_delivery.next_retry_at`,
`ad_creative.ad_set_id`/`.creative_type`/`.media_url`, `attribution_event.offer_id`/`.creative_id`/`.click_id`,
`broadcast_campaign.sender_account_id`/`.subject`/`.template*`, `intel_snapshot.video_count`,
`quote.payment_plan`.

---

## 4. Funcionalidad modelada pero no operativa

- **Google Calendar (P2)**: implementada pero apagada por bandera `AGENDA` (ausente en `.env`); sin
  OAuth authorization-code/callback (solo pegado manual de tokens).
- **Google Ads (P7)**: solo prueba de conexión (`integrations/test-connection.ts:133-265`); sin
  lectura de métricas ni tabla.
- **Analytics Hub (`/analytics`)**: redirige a `/dashboard` y su cliente es código muerto (M3).

---

## 5. Hallazgos de diseño con impacto (no bugs, pero requieren decisión)

- **Una sola oportunidad por contacto**: `lead_contact_uq` (`schema.ts:259`) es único por
  `contactId`; P6 exige varias oportunidades por contacto → requiere migración de la restricción.
- **Migración 62 ya consumida en producción**: la BD del VPS tenía aplicada la migración índice 62
  de otra rama, por lo que las tablas MCP no se crearon hasta la reparación `0064` (ver
  `drizzle/0064_mcp_oauth_repair.sql`). Señal de que hay ramas que reutilizaron índices.

---

## 6. Auditoría de seguridad y operatividad — 2026-10-19

Segunda pasada sobre producción (`Standard_B2ats_v2`, docker compose + Caddy, imagen
`ghostbreakfast69/lumark-crm:latest`). Los ids `A-01…A-16` son los del informe entregado;
`D-01…D-08` es deuda que apareció al verificar que la documentación dijera la verdad.

### 6.1 Cerrado y desplegado

| Id | Hallazgo | Cierre |
|---|---|---|
| A-01 | Traversal sin autenticación en media pública | `src/server/media-path.ts`: regex por segmento + `resolve` + prefijo + `realpathSync`; adoptado en las dos rutas públicas, el PDF y el media de WhatsApp. Pruebas en `tests/unit/media-path.test.ts` |
| A-02 | WAHA perdía **todo** evento con 2+ negocios (filtraba por `session`, no único entre tenants) | Se resuelve el negocio por token (HMAC del id) antes de mirar la sesión — `src/server/waha/webhook.ts:213-229` |
| A-03 | Zernio aceptaba eventos sin firma aunque la cuenta tuviera secreto | `src/server/zernio/index.ts:49` devuelve `false` |
| A-04 | El plugin `organization` dejaba crear negocios a cualquier sesión válida | `src/lib/auth/index.ts:110` → solo el dueño de la instancia |
| A-05 | `seed:demo` sembraba «la primera organización» sin `ORDER BY` | `scripts/seed/demo.ts:34-63`: con >1 negocio exige `--org=<id>` o se niega |
| A-06 | SVG de logo servido sin acotar (XSS en el origen) | `mediaHeaders()` → CSP `sandbox` + `nosniff` |
| A-07 | `err.message` de Better Auth/Postgres llegaba al navegador | `settings/clients` y `settings/team`: 409 en duplicado, mensaje genérico fuera, detalle solo al log |
| A-08 | `/api/auth/organization` sin límite de tasa | Bucket distribuido `org-provision:<userId>`, 10/10 min — `src/app/api/auth/organization/route.ts:29` |
| A-09 | Capa de firma de Meta inactiva **sin avisar** | Aviso único por proceso — `src/server/inbox/webhook.ts:40-46`. Queda la parte del dueño en 6.2 |
| A-10 | Caddy sin log de accesos ni `X-Real-IP` | `Caddyfile` (commit local `d77edea`); el archivo vive en el host por bind-mount, así que el cambio ya está servido |
| A-11 | Sin cabeceras de seguridad en ninguna respuesta | `next.config.ts` `headers()`: `nosniff`, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy, Permissions-Policy, HSTS 180 d |

Sin CSP global a propósito: los estilos inline de Tailwind romperían la UI y el único vector
real de contenido (el SVG que sube un miembro como logo) ya lleva su propio CSP + sandbox en
la respuesta de media.

### 6.2 Abierto — es acción del dueño, no código

| Id | Qué | Dónde | Por qué no puede cerrarse desde el repo |
|---|---|---|---|
| A-16 | **Revocar el token de GitHub pegado en un chat** (P0, abierto desde 2026-10-16) | github.com → Settings → Developer settings | Lo bloquea la cuenta del dueño. El token local de `gh` también está sobrer-scopado (`admin:org`, `admin:enterprise`, `delete:packages`) |
| A-09b | Fijar `META_APP_SECRET` | `~/crm-lumarketing/.env` de la VM | Medido: la variable existe pero **vacía** → las firmas de Meta se aceptan sin verificar. La app ya lo avisa en el log |
| A-13 | Copia de los backups **fuera de la máquina** | `~/scripts/backup-crm.sh` → `~/backups` | Facturable (Storage o Azure Backup). El script además borra dumps si quedan <4 GB libres: un disco perdido = cliente perdido |
| A-12 | Retirar la clave de Resend de `postiz-audit/.env.example:40` y el directorio | repo **público** | El valor sigue en el historial (`73c5929`); borrar el archivo no basta. Arriba dice «dummy», pero el formato es de clave real → verificar en la consola de Resend |
| A-14 | Presupuesto de memoria sobre-vendido | `docker-compose.yml` | Los límites suman 992 Mi sobre 836 Mi útiles y Portainer va sin límite. Subir de tamaño de VM exige deallocate (corte) |
| A-15 | Revisar el NSG de Azure | portal | `ufw` está inactivo: la superficie depende solo del NSG. Confirmar 22/80/443 y restringir 22 |
| — | Prueba manual de alta de negocios en la UI | `/settings/clients` | La API quedó cerrada por A-04/A-08; falta el smoke test de 3 clics en un navegador |

### 6.3 Deuda nueva detectada al documentar

- **D-01 — WAHA descarta eventos en silencio.** `src/app/api/webhooks/waha/[token]/route.ts:40-50`
  responde `200 {ok:true}` **antes** de procesar (para que WAHA no reintente) y llama a
  `handleWahaWebhook()` dentro de `after()`. Los `400`/`404`/`500` que devuelve
  `src/server/waha/webhook.ts:202,225,237` se construyen pero nadie los mira: el cliente ya fue
  aceptado. El `catch {}` de la línea 236 además no loguea. Consecuencia: un token mal pegado,
  un negocio borrado o cambiar el proveedor de WhatsApp a `meta` deja el CRM sin mensajes
  entrantes **sin ningún rastro en los logs**. Arreglo: `console.warn` con el id de organización
  en las tres salidas y loggear el error del `catch`. Es cambio de código en producción → queda
  a decisión del dueño.
- **D-02 — La unicidad que resuelve el enrutado no está en la BD.** `waha_credentials.session_name`
  (`src/lib/db/schema.ts:992`) y `account_ref` de instagram/messenger/tiktok
  (`schema.ts:526,557,585`) son columnas **sin UNIQUE**: los índices existentes son ordinarios.
  Hoy lo aguanta el código (`pickUnambiguousOrgRow` en `src/server/zernio/account-ref.ts:11-25`
  descarta el evento y avisa; WAHA enruta por token). Un `UNIQUE (organization_id, session_name)`
  / `(organization_id, account_ref)` convierte el error de configuración en un fallo al guardar.
- **D-03 — La US6 de plantillas se eliminó y los specs no lo dicen.** `630d1c6` (2026-10-01) borró
  el servicio, las rutas `/api/templates*`, la UI, el mock y las pruebas, y aplicó
  `drizzle/0021_drop_template.sql` (`DROP TABLE "template"`). `specs/001-zorro-tech-core/tasks.md`
  (T081-T086) seguía marcado `[X]` y `contracts/webhook.md` declaraba un field que ya no procesa
  nadie. Corregido el 2026-10-19 con nota en ambos archivos. Restos inertes:
  `template_name`/`template_language`/`template_params` de `broadcast_campaign`
  (`schema.ts:2412-2414`) — ningún código los escribe. Reactivar la US6 = tabla + rutas +
  procesamiento del field + suscripción en el panel de Meta + envío con `components`.
- **D-04 — Reenvío de follow-ups tras un crash.** El reaper de arranque
  (`src/server/automation-queue.ts:114-127`) vuelve a poner en `queued` las ejecuciones en
  `running` con `startedAt` viejo; si el proceso muere entre el envío y el `UPDATE … sent`, el
  mensaje se manda otra vez. El claim normal sí es atómico (`automation-queue.ts:165-170`), así
  que la ventana es estrecha. **Decidido no arreglar**: cambiar semánticas de entrega no puede
  probarse contra un WhatsApp real aquí y una guarda mal calibrada perdería follow-ups en vez de
  duplicarlos.
- **D-05 — `migrate.mjs` sigue fuera de CI.** `db:guard` valida journal ↔ `.sql` (eso cerró la
  causa de la caída del 2026-10-16), pero el CMD de la imagen es `node migrate.mjs && node
  server.js` y ninguna pipeline ejecuta las migraciones. Un `.sql` válido pero roto (FK a una
  tabla posterior, `CREATE TABLE` no idempotente sobre objeto existente) vuelve a dejar el
  contenedor en crash loop. Esa es la fase 3 del plan, aún abierta.
- **D-06 — El compose es una lista nominal.** Las variables nuevas no hacen nada si no se
  declaran en el bloque `environment:` del servicio `app`. Así se quedó apagada la bandera
  `INTEL` y así fallaron los flags de MCP. Al añadir cualquier env, tocar `docker-compose.yml`
  en la misma rama.
- **D-07 — Cuatro tablas fuera del modelo.** La BD de producción tiene 106 tablas y `schema.ts`
  define 102 `pgTable`; la diferencia es puramente aditiva y son `diagnostic_event`,
  `whatsapp_settings`, `integration_secret` y `whatsapp_address` (las cuatro las crea
  `drizzle/0006_diagnostics_messaging.sql`, que sí está en el journal). Riesgo real: `drizzle-kit
  generate` no las conoce, así que modelar una después emite un `CREATE TABLE` que choca.
  Detalle incómodo: el proveedor de WhatsApp se lee y se escribe con **SQL crudo** sobre
  `whatsapp_settings` (`src/server/whatsapp/provider.ts:4-9`), no con el schema. Y
  `whatsapp_address` no la referencia **nadie** — tabla muerta.
- **D-08 — El token de verificación de Meta es de instancia.** `META_WEBHOOK_VERIFY_TOKEN` protege
  `/api/webhooks/wa`, `/ig` y `/messenger` con el mismo valor para todos los negocios
  (`src/app/api/webhooks/wa/[webhookToken]/route.ts:25,43`; `ig/[webhookToken]/route.ts:31,51`;
  `messenger/[webhookToken]/route.ts:31,51`). La identidad del llamante no separa tenants; lo
  que sí lo hace es `META_APP_SECRET`
  (aún vacío, 6.2) y el ruteo por `phone_number_id`. WAHA no tiene este problema porque su
  segmento es un HMAC por organización.

### 6.4 Cómo verificar lo de esta sección

Hoy la suite local es 155 archivos / 1471 pruebas (`pnpm test`, ~142 s), y producción responde
`{"ok":true,"version":"1.8.0","commit":"ddb4c65"}` en `/api/health`. *(Estos dos números caducan:
hasta hoy decían 129/1123 pruebas y `v1.3.0 · 53f38c0` en producción — el estado de la instancia
cuando se escribió esta sección, tres releases antes (`v1.6.0`, `v1.7.0`, `v1.8.0`). Hay que
volver a medirlos, no retocarlos a ojo.)* Los probes de regresión de
A-01 se corren **dentro** del contenedor `crm-lumarketing-caddy-1` contra `http://app:3000`
(HTTPS desde la VM no sirve: se hairpina y devuelve `code=000`): una ruta con `%2e%2e%2f` debe dar **422**,
un archivo inexistente **404**, y un logo real 200 con `nosniff`.

Para saber si el esquema quedó al día tras un despliegue, dos cosas que no son obvias y que este
runbook no decía (ver §6.16): el log de arranque **no** enumera las migraciones aplicadas —solo
`[migrate] migraciones aplicadas`, que también sale cuando no había nada que hacer—, y **contar
filas del ledger no prueba nada** porque ahí conviven 82 entradas del journal con 80 filas por
culpa de dos migraciones aplicadas a mano. Lo que sí prueba: comparar las filas del ledger con
el manifest **por hash del SQL** (la fórmula la firma `scripts/migrate.mjs`), o verificar el
objeto concreto en `information_schema`.

### 6.5 Pase de «cada configuración hace lo que promete» (2026-10-19, tarde)

El disparador fue un reclamo concreto: se guardaba «Dorado» en Ajustes → Marca y la
interfaz seguía lima. El defecto no estaba en el guardado —la BD tenía el color—, sino
en la **lectura**: el layout raíz pedía la marca sin organización y la regla
falla-cerrada devolvía la neutra en cuanto existe un segundo negocio. Se cerró con
`getBrandingContextForRequest()` (leer la marca de la sesión de la petición) más cuatro
pruebas que renderizan el HTML real del layout y del login.

Cerrado en el mismo pase, porque eran la misma clase de defecto (algo se guarda y no se
aplica, o se aplica pero miente):

- Favicon y `<title>` de las páginas autenticadas caían igual al neutro.
- La URL del favicon no distinguía negocios: dos tenants con el mismo nombre compartían
  la entrada de caché del navegador y uno veía el logo del vecino.
- La pantalla de acceso tenía el logotipo y el naranja de **otra** empresa incrustados,
  sin variables: ya usa la marca de la instancia (neutra si hay varios negocios).
- Dos páginas ponían `Zorro Tech CRM` en `metadata.title`, que **pisa** el título del
  layout: en `/commercial` la pestaña perdía el nombre del negocio. El layout ahora usa
  `title.template` y las páginas solo nombran la sección.
- `reactWithEmoji` y `activeInNewConversations` se guardaban, se leían en el GET y salían
  en la tarjeta, pero el turno del agente no los consultaba: ningún punto de ejecución.
- `serializeBotProfile` recortaba el perfil a cinco campos: el cerebro externo nunca
  recibía rubro, ubicación, descripción, idioma, idioma de respaldo, espera máxima ni
  palabras de etapa.
- `email_account.enabled` tenía guard en el servicio y badge On/Off en la tarjeta, pero
  ni la ruta aceptaba el campo ni había dónde moverlo: las cuentas no se podían apagar.

Dejada, con nombre y apellido (es decisión del dueño, no un olvido):

- **Cuenta de bot por instancia.** `/api/bot/*` resuelve el negocio con
  `resolveInstanceOrg()`, que devuelve `null` cuando la instancia tiene dos o más
  negocios → el endpoint responde 409 y el cerebro externo queda inutilizable en modo
  multi-negocio. El arreglo son claves por tenant (`bot_api_key` en el perfil) y ensancha
  lo que alcanza una filtración de `BOT_API_KEY`; por eso no lo decidí yo.
- **Borrado global de `/settings/diagnostics`**: la purga del owner borra eventos de
  TODAS las organizaciones. Sin fugas de lectura, pero sin acotar.
- **`META_WEBHOOK_VERIFY_TOKEN` es de instancia** (D-08) y **el badge de IA** mira el
  `.env` antes que la clave por negocio: solo pinta mal, `resolveAiConfig` sí prefiere la
  del tenant.
- **`--info` sigue lima** con acento dorado: un solo uso y el color es semántico.
- **Esquema inerte** de §3 (`loss_reason_catalog` sembrada y nunca leída,
  `qualification_criteria`, `google_ads_metric` en bucle cerrado, columnas de
  `email_account` sin escritor): borrar tablas es migración irreversible sobre la BD de
  producción; se deja documentado.

### 6.6 Entrega v1.6.0 (20-10-2026) — qué se hizo y qué queda abierto

**Desplegado en producción** el 20-10-2026 a las 18:29 UTC, con `main` en `62957c2` (7 commits
sobre `269c3c7`): CI y Build & Push en verde, `[migrate] migraciones aplicadas` en el log del
contenedor y `project_template` ya creada con 0 filas — los procesos se siembran al usarlos.

Cerrado en código, con pruebas unitarias (`pnpm test`: 135 archivos / 1209 pruebas,
`typecheck`, `lint`, `db:guard` y `next build` en verde):

- **Procesos personalizables por negocio** (`project_template`, migración 0079). Los 3
  base son `is_system` sólo en el negocio más antiguo; en los demás son copias editables.
  Cada proyecto congela etiqueta y definición de pasos, así que renombrar o borrar un
  proceso no reescribe proyectos viejos.
- **Cotizaciones también por correo**: el cotizador lista los hilos del buzón y responde
  dentro del hilo elegido con el PDF adjunto. El destinatario, asunto `Re:` e
  `In-Reply-To` los resuelve el servidor desde sus propias filas (tenant-scoped); la API
  no acepta una dirección tecleada.
- **Bandeja con IA en negocios recién creados**: `action:"none"` ya no es un silencio
  infinito —si nadie ha respondido, el turno saluda con la bienvenida del negocio— y cada
  turno mudo se loggea con el motivo (`handoff`, `ia_apagada`, modelo calló).
- **PDF de cotización en Messenger**: los documentos salen por multipart con el nombre
  legible; con `attachmentUrl` el cliente veía la clave que genera el proveedor.
- **Inteligencia**: el historial en vivo es de la consulta buscada; la serie del nicho
  del catálogo que se parece aparece ANIDADA y etiquetada con su % de parecido.
- **Contactos sin filtro de etapa**: el selector del embudo sale de la pantalla. Sigue
  listando la cartera (`?won=1`, igual que antes) y la etapa sigue pintada en cada ficha;
  el parámetro `?stage=` del API queda para cualquier otro cliente.

Abierto a propósito:

- **`quotes.send` del MCP y del agente de la Bandeja siguen siendo de chat.** El correo no
  es un `Channel` ni tiene filas en `conversation`, y los hilos entrantes quedan con
  `contact_id = null` (contacto no tiene columna de email). Que el agente cotice por correo
  exige unirlas antes; se deja como feature, no como parche.
- **El envío sale dentro de la transacción** (igual que WhatsApp antes): si el `update`
  posterior fallara, el cliente ya recibió el archivo y la cotización sigue en `draft`.
- **El selector de correo usa `/api/email/accounts`, que es `withOwner`**: un miembro que
  no es owner no ve hilos de correo en el cotizador (sí ve chats).
- **WAHA sigue respondiendo 200 aunque el `after()` falle** (D-01): el 200 ya va enviado,
  así que el reintento exige procesar en línea; no se tocó sin poder probar contra el
  proveedor.
- **Lo multipart de Zernio no está verificado contra el proveedor**: el arreglo está
  cubierto por prueba unitaria del cuerpo de la petición, no por un envío real. Hay que
  mandarle un PDF a un chat de Messenger en producción para confirmarlo.

### 6.7 Entrega v1.7.0 (20-10-2026) — Prospectos, Calendario accesible y el lote del dueño

Cerrado en código, con pruebas (`pnpm test`: 145 archivos / 1352 pruebas; `typecheck`,
`lint`, `db:guard` y `next build` en verde; espejo de las migraciones 0081 y 0082 sobre un
`pg_dump` de la base real en la VM, rc 0 y re-ejecutables):

- **IA por canal** (0081, `disabled_channels`): un interruptor apaga al agente en todo el
  canal; lo respetan el turno interno y las cuatro rutas del cerebro externo.
- **Prospectos** (`/prospects`): módulo nuevo sin tabla ni migración propia — proyección de
  los contactos con mensaje entrante en hilo real.
- **Teléfono desde el chat** (`inbox/phone-capture.ts`): escritura append-only en los siete
  canales de `ingestInboundMessage` + chat de Mercado Libre.
- **Cotización**: bloque único NOTAS, `client_phone` en el PDF (0082) e IVA a 0 cuando el
  cliente lo pidió explícitamente.
- **Formato del agente** (`ai/reply-format.ts`): normalización por canal antes de enviar.
- **Calendario**: el módulo estaba encendido (`AGENDA=on` en la VM) y aun así era
  inalcanzable — no había entrada en el menú ni pestaña en Ajustes. Ahora el menú, el ⌘K y
  Ajustes se filtran con el flag resuelto en el servidor.

Queda abierto, declarado:

- **Nada de esto se ha visto renderizado en el teléfono del dueño.** El formateador está
  probado como función; cómo cae la lista en WhatsApp real, y si el PDF con NOTAS y teléfono
  se lee bien, es verificación en vivo pendiente.
- **Prospectos no tiene historial**: los mensajes anteriores a este despliegue sí aparecen
  (la consulta se deriva de los mensajes), pero el teléfono de quien lo escribió antes y se
  queda sin número nunca se va a recuperar solo.
- **La captura ignora comentarios públicos y reseñas de Google Business** a propósito (un
  número ahí suele ser el del propio negocio). Si el dueño pide lo contrario, es una línea
  por superficie, no un rediseño.
- **El plegado de comentarios por persona ocurre al consultar**, no con una migración que
  reescriba `conversation`. Con volumen alto de comentarios habrá que materializarlo; hoy es
  más seguro no tocar mensajes ya recibidos.
- **Calendario sin horario configurado no agenda**: si Ajustes → Calendario no tiene días
  habilitados, el motor ofrece cero huecos y el agente responde sin agendar. No es un fallo,
  pero se siente como uno.
- **`iva:false` es la única excepción de impuesto que entiende el agente**; el MCP y el
  cotizador siguen tomando el tipo de la organización, así que "sin IVA" por otra vía exige
  pedirlo en el cotizador.

### 6.8 Pase de auditoría del lote v1.7.0 (21-10-2026) — 15 hallazgos, 13 corregidos

Cuatro subagentes auditaron lo desplegado el 20-10. Cada hallazgo se **verificó por
lectura o ejecución antes de tocar nada** (dos resultaron falsos, abajo). Los 13 corregidos
quedan fijados con prueba en verde; tres —F5, F9 y F13— se comprobaron además **por retorno**
(se revirtió el arreglo en el árbol de trabajo, la prueba falló, se restauró). Gates del lote
de correcciones: `typecheck`, `lint`, `db:guard` y `next build` en verde; `pnpm test`
**149 archivos / 1404 pruebas** (antes: 145/1352).

**Este lote está en el working tree y NO está commiteado ni desplegado**: la autorización
del dueño («Sí, desplegar todo el lote») cubrió v1.7.0, no estas correcciones.

| # | Hallazgo | Severidad | Estado |
|---|----------|-----------|--------|
| F1 | `updateQuote` trataba `undefined` como orden de borrar: una edición desde MCP reimponía el 16 % a una cotización «sin IVA» y mandaba contacto, descuento y partidas a `null` | P1 · Confirmado mediante pruebas | Corregido — filtro del parche en `quotes/service.ts:286`; `quote-partial-update.test.ts` |
| F2 | `listQuotes` no devolvía nombre de contacto: el listado decía «Sin contacto» en todas las tarjetas | P2 · Confirmado mediante pruebas | Corregido — segunda consulta acotada al tenant, `quotes/service.ts:790`; mismo archivo de prueba |
| F3 | `prompts.ts` no tenía `case "es"`: elegir «Español» en Ajustes caía en la rama Automático y el cliente que escribía en inglés recibía inglés | P1 · Confirmado mediante pruebas | Corregido — `ai/prompts.ts:211`; `agent-prompt-config.test.ts` |
| F4 | `stripEmphasis` rompía URLs y SKUs (`…/a_b_c` → `…/abc`), además de dejar sangría impar en las listas | P2 · Confirmado mediante pruebas | Corregido — lookbehind en `reply-format.ts` + colapso de espacios dobles; `agent-reply-format.test.ts` |
| F5 | «te lo entrego el 15-10-2026» se grababa como **teléfono del cliente** en Prospectos | P1 · Confirmado mediante pruebas | Corregido — `AS_DATE_WRITTEN` en `inbox/phone-capture.ts:70`, mirada sobre el texto crudo del candidato; `prospect-phone-capture.test.ts` |
| F6 | `href={"tel:+" + phone}` con 10 dígitos nacionales: el móvil lee prefijo extranjero (462… → Suecia) y la llamada no sale | P1 · Confirmado mediante pruebas | Corregido — `dialHref()` / `formatPhone()` en `lib/utils.ts:73`, regla `>10 dígitos = trae código de país`; `phone-dial-link.test.ts` |
| F7 | Handoff del modelo sin `farewell` (clave opcional del esquema) pasaba la conversación a un humano con el cliente **mudo** | P1 · Confirmado mediante pruebas | Corregido — respaldo obligatorio en `ai/pipeline.ts:738`; `agent-toggle-respuesta.test.ts` |
| F8 | `GET /api/bot/availability` no tenía guarda de canal/IA y **escribe**: dejaba oferta vigente registrada para una conversación que nunca puede agendar | P2 · Confirmado mediante pruebas | Corregido — 409 `ai_paused` igual que `/messages`; `bot-routes-guards.test.ts` |
| F9 | `POST /api/bot/messages` mandaba el texto crudo del cerebro externo: sin formato y, si pasaba del tope del canal, `sendText` lo rechazaba y no llegaba nada | P2 · Confirmado mediante pruebas | Corregido — pasa por `formatAgentReply` + `fitsChannel`; `bot-routes-guards.test.ts` |
| F10 | El guard del canal apagado corría **después** de limpiar el handoff por ventana: la ficha de Bandeja mostraba «atendido por el bot» cuando nadie respondía | P2 · Confirmado mediante inspección y pruebas | Corregido — orden invertido en `runAgentTurn`; el traspaso solo se reabre si alguien va a responder |
| F11 | Diálogo de nueva cotización: `Number("")` → 0 (borrar el campo dejaba «sin IVA» sin querer), un `16.5` rebotaba contra `z.int()` con 422 mudo, y vaciar Notas no las vaciaba (`|| undefined`) | P2 · Confirmado mediante pruebas | Corregido — tope 0-100 y envío tal cual en `new-quote-dialog.tsx`; `paymentConditions` solo se toca si la clave viene |
| F12 | PDF: una palabra más ancha que la columna (token, URL, código) salía sobresaliendo del margen; «COTIZADO PARA» quedaba como etiqueta sola | P2 · Confirmado mediante pruebas | Corregido — corte por ancho de caracter en `documents/pdf.ts:34` y línea «Sin contacto asignado» en `quotes/pdf.ts:163`; `pdf-fit.test.ts` |
| F13 | `markRead: false` ejecutaba el abanico del hilo plegado: reescribía `updatedAt` de **todas** las conversaciones de la persona sin limpiar nada | P2 · Confirmado mediante pruebas | Corregido — la guarda es `patch.markRead === true` (`inbox/queries.ts:294`); `conversation-mark-read.test.ts` |
| F14 | Buscar `%` o `_` en Prospectos no devuelve nada | **Descartado** | No es bug: el patrón ya se escapa (`prospects/query.ts:76` y, igual, `api/contacts/route.ts:59-74`) y viaja como parámetro ligado, donde `LIKE` ya usa `\` de escape. Se dejó prueba de regresión (`%100\%%`, `%a\_b%`) para que nadie lo rompa al tocar la búsqueda |
| F15 | Orden del lead con `last_activity_at` NULL: en Postgres `DESC` pone los NULL **adelante**, así que `limit(1)` elegía el lead sin fecha y ocultaba la etapa real | P1 · Confirmado mediante pruebas | Corregido — `descNullsLast()` en `lib/db/order.ts`, aplicado en 9 lecturas (8 archivos: `contacts`, `agenda/service` ×2, `automation-events`, `bot/reset`, `bot/context`, `prospects/query`, `ai/pipeline`, `lead-activity`) |

Hallazgos cercanos que tampoco resultaron serlo, con su motivo (regla del dueño: toda
superficie que se deja de tocar se declara):

- **`ads/query.ts` ordena `campaignInsight.dateStart` (nullable) con `desc` sin `nulls
  last`.** No se cambió: esas lecturas van filtradas con `gte(dateStart, …)`, y `gte`
  excluye NULL, así que el caso que rompe F15 no puede aparecer ahí.
- **`suppliers-client.tsx:457` arma `tel:${value}` con el teléfono libre de proveedor.** Se
  dejó igual a propósito: ese campo es texto libre del operador y suele traer extensiones
  (`+52 443 111 2233 ext 4`); normalizarlo a 10/12 dígitos perdería información visible
  para ganar un enlace que el dueño no reportó roto. Prospectos y Contactos sí muestran
  números canónicos de cliente, y ahí estaba el bug.

Qué sigue abierto después de este pase:

- **Nada verificado en vivo.** Las 13 correcciones están probadas como función y como SQL
  generado; el IVA respetado sobre una cotización real, la llamada que sale del teléfono
  del dueño, y el PDF sin texto fuera de margen siguen siendo verificación humana pendiente.
- **F5 no repara datos ya escritos**: los teléfonos-fecha que entraron entre el despliegue
  de v1.7.0 y este arreglo siguen en `contact.phone`. Es una limpieza con criterio (10
  dígitos que además casan `AS_DATE_WRITTEN`), no un bug de código, y toca datos reales:
  requiere autorización del dueño.
- **`hasCountryCode` es una regla de longitud, no un catálogo de países**: un número
  extranjero de 10 dígitos se pinta sin `+`. Aceptable mientras el negocio sea mexicano
  (`normalizeMx` ya canonaliza 521→52); si algún día entran clientes de otro país, la
  solución es guardar `phone_country` o el E.164 completo, no adivinar por longitud.
- **Los dos `farewell` del handoff** (respaldo y texto del modo humano) son cadenas fijas en
  español dentro del pipeline. Si el negocio responde en otro idioma, el respaldo no se
  traduce; hoy solo se siente si el modelo omite el `farewell`.

### 6.9 Bug report del dueño: «no agendo el prospecto» y «solo hace una ficha» (21-10-2026)

Reporte con captura de Prospectos (negocio Honeycat MX, contador en 0, estado vacío). Dos
causas distintas, ambas confirmadas antes de tocar código.

**Causa 1 — Prospectos devolvía 500 y la pantalla lo contaba como «no hay prospectos».**
Confirmado mediante pruebas en producción: 8 eventos `api_failed` con
`TypeError: b.firstInboundAt?.toISOString is not a function`, 7 de ellos del tenant
`org_q5s3` entre 06:54:11 y 07:05:44Z del 21-10, contenedor `eeb9443`. Los datos están
bien: el mismo SQL devuelto a mano trae 4 filas de Honeycat y 1 del principal.
- Arreglo: `isoDate()` en `server/prospects/query.ts` normaliza en el borde del DTO lo que
  trae el driver (`Date`, string ISO, vacío, basura) en lugar de asumir una forma. Los
  fragmentos `sql` de `MIN/MAX(COALESCE(…))` no llevan decodificador de columna, así que el
  tipo runtime depende del driver y `.toISOString()` sobre ellos no es seguro.
- **No** se añadió `.mapWith(schema.message.createdAt)` a esas proyecciones, declarado a
  propósito: en modo string es un no-op y en modo date intentaría decodificar valores que ya
  llegan como `Date`. La normalización en el DTO es el borde correcto.
- El mecanismo exacto por el que el driver devolvió ese valor sigue **Hipótesis pendiente**;
  el arreglo es agnóstico de la forma.

**Causa 2 — el agente no podía mandar más de una ficha por turno.**
`send_quote` aceptaba un único `item_id` obligatorio (mientras `create_quote` ya admitía
hasta 10 partidas), así que un cliente que pregunta por varios productos recibía una sola
ficha. Confirmado mediante inspección y pruebas.
- Arreglo: `item_ids` (array de hasta 5) en `ai/actions.ts`, un `send_quote` recorre los IDs
  **en el orden pedido** (no en el del `inArray`), deduplica, y emite **un mensaje por ficha**
  porque el tope de bytes del canal es por mensaje (`channels/capabilities.ts`). Con una sola
  ficha, el `reply` viaja pegado a ella; con varias, cada una es su mensaje.
- El prompt (`ai/prompts.ts`) ahora obliga a una sola `send_quote` con todos los IDs ya
  conocidos cuando el cliente pide varios productos.

**Barrido de la clase «fallo de lista leído como lista vacía»** (regla del dueño: «sigue»,
todas las superficies). Patrón corregido: `fetch().catch(() => null)` + `if (!res?.ok) return`
dejaba el estado vacío como único render. Ahora todas estas pantallas distinguen
«no se pudo leer» de «no hay datos» con el componente compartido `components/load-error.tsx`,
y el panel de error **solo sustituye al estado vacío, nunca a una lista ya cargada**
(`failed = Boolean(error) && items.length === 0`):

| Superficie | Qué muestra hoy si la API falla |
|---|---|
| `prospects/prospects-client.tsx` | Cabecera «— / Lista no disponible» + panel con Reintentar |
| `inbox/inbox-client.tsx` + `inbox/conversation-list.tsx` | «No se pudo leer la bandeja.» en vez de bandeja vacía |
| `contacts/contacts-client.tsx` | Panel antes de «Aún no hay clientes» |
| `quotes/quotes-client.tsx` | Panel antes de «Sin cotizaciones» |
| `projects/projects-client.tsx` | Bandera separada por pestaña (activas / archivadas) |
| `bookings/bookings-client.tsx` | Panel con Reintentar sobre «Todavía no hay nada agendado» |
| `pipeline/pipeline-client.tsx` | Tablero: error real vs «sin etapas configuradas» |
| `catalog/catalog-client.tsx` | Panel antes de «Sin productos» |
| `suppliers/suppliers-client.tsx` | Panel antes de «Sin proveedores» |
| `email/email-client.tsx` | Cuentas y mensajes con banderas independientes, cada uno con Reintentar |
| `broadcasts/broadcasts-client.tsx` | Los tres `fetch` ya no se arrastran entre sí (`.catch` individual) + aviso de no duplicar el envío |
| `settings/client-businesses-card.tsx`, `settings/team-client.tsx` | Usan la línea de error que ya existía en el formulario |

Superficies dejadas a propósito, con su motivo (nada se omite en silencio):

- **`copilot-client.tsx`, `lab-client`, `analytics-client`, `automations-client`,
  `inteligencia/*`, `settings/ads-client`, `settings/agenda-client`, `inbox/contact-panel`,
  `pipeline/lead-drawer`, `agent-client` (base de conocimiento)** — su fallo es diagnóstico o
  de un panel secundario: no afirman «no hay datos» ante un 500, o el texto que muestran es
  una invitación a configurar, no una afirmación de vacío.
- **`use-unread-count.ts`** — lo que se pone a 0 es un badge; no redacta una lista vacía.
- **`quote-detail.tsx`** — los selectores vacíos son un `<select>` sin opciones, sin texto que
  engañe.
- **`inbox-client.tsx` → `refetchMessages`** — los mensajes del hilo abierto se reemplazan por
  lo que devuelve la API y no existe texto de «sin resultados» que atribuir al fallo.

Gates de este lote: `db:guard` (0 avisos, sin migraciones), `typecheck`, `lint`,
`pnpm test` **149 archivos / 1416 pruebas** (antes 149/1404) y `next build`, todos en verde.
Pruebas nuevas: `prospects-query.test.ts` (formas de fecha del driver),
`agent-formal-quote.test.ts` (orden, deduplicado, ficha única, faltantes) y
`agent-actions.test.ts` (`item_ids` vacío / >5 rechazados).

**Este lote está en el working tree y NO está commiteado ni desplegado**: la autorización
anterior cubrió v1.7.0; el push a `main` despliega y necesita autorización nueva.

### 6.10 Inteligencia: las fuentes se relacionan con la búsqueda, no se ocultan (21-10-2026)

Queja del dueño: *«en inteligencia quitaste todas las demas fuentes de info cuando lo que
tenias que hacer era relacionar la informacion con la busqueda de google trends para que
todas las apis de inteligencia dieran informacion relacional a la consulta»*.

**Antes** (arreglo de la tarea #92, Detectado mediante inspección): la sección
«Explorar más» —nichos monitoreados, tendencias del país, comparativa, YouTube, audiencia y
mapa DENUE— se cerraba en cuanto había una búsqueda activa, para no mezclar datos de otro
nicho con la consulta. El efecto real era el que se quejó: **una búsqueda dejaba la pantalla
con una sola fuente**. La causa del mezclar no era la visibilidad, era que los paneles se
leían sin declarar a qué término pertenecían.

**Ahora**: las fuentes nunca se cierran por buscar. Con búsqueda activa la sección se llama
«Contexto de tu búsqueda» y cada panel declara con qué se relaciona:

| Fuente | Cómo se ata a la consulta | Mecanismo |
|---|---|---|
| Tendencias actuales (país) | la tabla arranca filtrada por la palabra; vaciar el campo devuelve el país completo | `TrendingPanel relatedTo` → estado `query` → `mentionsQuery()` |
| Ranking de nichos | cada nicho lleva etiqueta `es tu búsqueda` (cruza el umbral) o `N% parecido`, con tooltip que distingue vecino de idéntico | `GtRanking related/queryLabel` sobre `catalogMatches` |
| Comparativa multi-nicho | la serie **en vivo** de la consulta es la línea gruesa de color de marca; las demás son los nichos, para comparar contra ella | `intelFocusSeries()` → `GtCompareChart focus` |
| Subregiones / temas / consultas GT | el selector abre en el nicho más parecido y cada chip muestra su % | `catalogMatches[0]` → `setActiveTermId` |
| Contenido que funciona (YouTube) | la muestra popular se acota a los videos que mencionan la consulta y dice «N de M»; si ninguno la menciona, lo explica en vez de mostrar la muestra completa | `getContentInsights(org, days, q)` con `mentionsPhrase` |
| Mapa de competencia (DENUE) | abre en el nicho monitoreado más parecido, con nota que lo declara | `GeoPanel relatedTermId/queryLabel` |

Soporte nuevo (todo calculado sobre datos ya leídos, **sin peticiones extra**):
`rankTerms()` y `mentionsPhrase()` en `server/intel/terms.ts`, y el campo `catalogMatches`
que `analyzeKeyword()` añade a la respuesta de `/api/intel/keyword` — reutiliza el catálogo
que la propia función ya había consultado. `rankTerms` no exige el umbral `TERM_MATCH_MIN`:
un 0.4 no es «este nicho», pero es el vecino más próximo y se muestra como contexto con su
porcentaje. `intelFocusSeries()` solo dibuja línea si la consulta trajo ≥2 puntos; con un
dato o sin mercado devuelve `null` y la comparativa se queda como estaba.

Dos reglas de texto, cada una en su pantalla y las dos declaradas en ella:
`mentionsPhrase()` (servidor) exige **todas** las palabras y acota la muestra de YouTube —son
títulos de producto del nicho—; `mentionsQuery()` (`lib/intel-content.ts`, en el navegador)
basta con **una** palabra para la tabla de tendencias del país, porque exigir la frase completa
la dejaba vacía delante de tendencias que sí van del tema. Las dos ignoran acentos, vacías
(«de», «la»…) y plurales; el `includes` literal que había antes fallaba siempre contra los
títulos acentuados del feed de México. `mentionsQuery` vive en `lib` y no importa `terms.ts` a
propósito: el módulo del servidor arrastra `@/lib/db` al bundle del navegador.

Ni se tocó ni se puede relacionar, declarado:

- **`AudiencePanel`** — es demografía del país (ENDUTIH 2024), no tiene dimensión de palabra.
- **Búsqueda en vivo de YouTube para la consulta** (`searchVideos`) — cobra 100 unidades de
  cuota por llamada; se mantiene la muestra popular ya ingerida y el panel explica cómo
  conseguirla. Si el dueño quiere el buscador real de YouTube, es una decisión de cuota.
- **Mapa DENUE en vivo para una frase que no está en el catálogo** — son 32 consultas por
  término; por eso el mapa se queda en el nicho que sí coincide y, si solo hay un vecino, la
  pantalla lo nombra con su porcentaje en vez de hacerlo pasar por la búsqueda.
- **El nicho solo se fuerza si la coincidencia es real**: `intelNicheAnchors` separa `focus`
  (el nicho que cruza `TERM_MATCH_MIN`, y por tanto es el único que mueve los paneles GT y el
  mapa) de `nearest` (el primero del ranking, que solo se etiqueta). Con `catalogMatches`
  vacío —o con un vecino al 40 %— el selector y el mapa conservan el término que el dueño
  tenía puesto; nunca se afirma parentesco donde no lo hay.

Gates: `db:guard` (0 avisos, sin migraciones), `typecheck`, `lint`, `pnpm test`
**150 archivos / 1436 pruebas** (antes 149/1416) y `next build`, todos en verde. Pruebas
nuevas: `rankTerms` (orden, umbral, vía, límite y desempate), `mentionsPhrase` (plural,
acentos, no subcadena), `mentionsQuery` (una palabra basta, vacías, acentos, tecleo a medias),
`intelFocusSeries` (línea de referencia, sin mercado, un solo punto),
etiquetas del `GtRanking` renderizado y `tests/unit/intel-content-scope.test.ts`
(acotado, recorte de la consulta, «1 de 2» y muestra vacía honesta). Se borró la prueba de
`showMonitoredExplorer`, la función que ocultaba las fuentes.

**Tampoco este lote está commiteado ni desplegado.** Deshacer: devolver `intel-client.tsx` a
la sección con `explore` como puerta, quitar `related/relatedTo/query/focus` de los paneles y
dejar `catalogMatches`/`rankTerms`/`mentionsPhrase` sin uso — el API sigue respondiendo con
ese campo de más sin que nada se rompa.

Deuda documental dejada en evidencia al escribir esta sección: `docs/SISTEMA-COMPLETO.md` no
tiene capítulo del módulo de Inteligencia (sus 27 secciones cubren bandeja, agente, contactos,
cotizaciones, proyectos… y saltan de «Configuración del Sistema» a «Variables de Entorno»). El
contrato de esta pantalla quedó aquí y en el entregable de Desktop; abrir el capítulo propio es
tarea aparte, no un parche de este lote.

> **Cerrada el 21-10-2026** con el lote del push: `docs/SISTEMA-COMPLETO.md` tiene ahora **§33
> Inteligencia de mercado** (bandera y 404, doce rutas, once tablas, cadena de respaldo SerpApi →
> Apify → conector web → sin datos, jobs `202`/409 con índice único parcial, la regla de anclaje
> de la búsqueda y su estado de verificación) y **§34 Agenda y Citas**. El índice general se
> actualizó; `docs/DOCUMENTACION-COMPLETA-SISTEMA.md` recibió el bloque de tablas `intel_*`, las
> rutas `/api/intel/*` y las secciones de Prospectos e Inteligencia.

### 6.11 Auditoría de las cuatro clases de bug (21-10-2026) — límites, lecturas caídas, fechas y descuento

Petición del dueño: «audita todo y arregla los bugs» sobre el árbol de trabajo sin commitear
(82 archivos, +2 658/−411). Cuatro frentes, cada uno barrido en todas las superficies donde
aparece, no solo donde se vio el síntoma.

**B1 — `?limit=abc` devolvía 500 y la pantalla lo leía como «no hay datos» (P2, corregido).**
Cuatro rutas hacían `parseInt(url.searchParams.get("limit") ?? "50")` sin respaldo: `NaN`
viajaba hasta Postgres como `LIMIT NaN`, la consulta reventaba y el 500 se pintaba vacío. Ahora
existe `intParam(url, name, { fallback, min, max })` en `src/lib/api.ts` (ausente, vacío, basura
→ respaldo; negativo o desbordado → se acota al rango) y lo usan `/api/projects`, `/api/expenses`,
`/api/catalog` y `/api/email/messages`, con `min: 1` en todos los límites. Pruebas:
`tests/unit/api-int-params.test.ts` (7). Las demás rutas ya validaban por zod o por `clamp`.

**B2 — la lectura caída se seguía pintando como vacío (P2, barrido hasta 13 superficies).**
Con `LoadError` ya existían Bandeja, Prospectos y listas mayores, pero quedaban los sitios que
mandan decisiones del dueño. Añadidos: Mercado Libre (para que un 500 no invite a re-pegar el
Client ID), credenciales de conectores (`connector-credentials.tsx`: ahora avisa de que los
campos están vacíos porque falló la lectura, no porque falten secretos), cotización (chats +
hilos de correo), diálogo de enviar producto, etapas del alta de contacto, mensajes del hilo de
Bandeja, Copiloto (lista e hilo, y el hilo se limpia antes de leer para no dejar publicado el
anterior), agenda (`/availability`), actividad de CAPI, Laboratorio (historial, reporte y la
barra `width: NaN%`), correo (cuentas e hilos por separado) y **el contador de no leídos**:
`useUnreadCount` devuelve `null` —no `0`— cuando no se pudo leer, y `null` no pinta badge; un `0`
afirmaba «nadie espera» con la Bandeja llena. También el panel de Análisis, que tras un 500 se
quedaba mudo. Dos avisos del propio barrido corregidos al revisar el diff: `quote-detail`
aseguraba «no se pudieron leer los hilos» cuando las dos lecturas habían ido bien y no había
destinos (ahora `sendTargetsError` es `null` sin lectura caída), y `email-chat` reutilizaba el
`error` del compositor, que pintaba «no se pudieron cargar los correos» tras un envío fallido
(ahora `threadsFailed` propio). Queda deliberadamente como está `automations-client`: sus lecturas
caídas muestran `—` o los presets declarados en pantalla, que no es una afirmación de vacío.

**B3 — scoping multi-tenant: seis sospechas, cero fugas (verificado, sin cambios).**
Cada sospecha de un subagente se comprobó a mano y se descartó con la reason: `lab/runs/[id]`
valida la corrida con `scoped()` antes de leer sus casos; `bot/context` filtra la conversación
por organización en el `WHERE`; los `assetId` de `channels/send.ts` los genera `newId()` la misma
llamada y se insertan con la organización del invocante; `persistDelivery(booking.id)` parte de un
booking ya acotado; `hasClientRepliedSince` lee mensajes de una sola conversación; y sirviendo
media, `/api/media/[assetId]` vuelve a comprobar organización con `scoped()` + `readMediaFile`.
El posible abanico del `LEFT JOIN conversation` en `/api/pipeline/board` está cerrado por el
`uniqueIndex("conversation_org_contact_real_idx")` (`schema.ts:411-414`): una conversación real
por (organización, contacto). Medido en producción dentro de la VM, sin escribir nada:
`filas_kanban=2 / leads_distintos=2` y `contactos_con_mas_de_una_conv=0 / max_conv=0`. Queda como
riesgo latente, no como fuga confirmada.

**B4 — fechas en UTC y descuento huérfano (P2 y P3, corregidos).**
El contenedor corre en UTC y el negocio es `America/Mexico_City` (UTC−6): entre las 00:00 y las
06:00 locales cualquier `new Date().toISOString().slice(0,10)` era *ayer*. Nace `src/lib/dates.ts`
(`zonedDateInput`, `zonedMonthBounds`) y se aplica en `reportPeriod` (Finanzas), `currentMonthRange`
del servicio (antes usaba `setMonth(-1)` sobre la fecha local del proceso: en el arranque del mes
devolvía el mes anterior), el rango por defecto de Balance, las fechas iniciales de los diálogos de
pago y gasto, y el `today` de `dashboard/metrics.ts` que marcaba vencida una factura el mismo día de
su plazo. Pruebas: `tests/unit/finance-period.test.ts` (6), incluida la frontera del 1 de
noviembre 01:00 UTC → 31 de octubre y febrero bisiesto. En cotizaciones, `discountPair()` garantiza
que `discountValue` no se guarda sin `discountType` (crear y actualizar): antes, quitar solo el
tipo dejaba un importe que el editor volvía a rellenar y el dueño aplicaba un descuento que no
pidió. Se probó en `quote-partial-update.test.ts`. Descartado con motivo: el `NaN` de precio en
`catalog-client.tsx:106` es inalcanzable (`type="number"` con `min="0"`), y el truncado de
`money.ts:91` y la vista previa flotante de `new-quote-dialog` siguen siendo deuda cosmética.

Gates de este frente: `db:guard` (0 avisos, sin migraciones nuevas), `typecheck`, `lint`,
`pnpm test` **152 archivos / 1453 pruebas** (antes 150/1436) y `next build`, todos en verde.
Nada de esto está commiteado ni desplegado. Deshacer por bloque: quitar `intParam` de las cuatro
rutas y borrar `lib/api.ts` y su prueba; devolver `src/lib/dates.ts` a los llamadores y volver a
`toISOString().slice(0,10)` / `setMonth(-1)`; quitar `...discountPair(input)` de los dos puntos de
escritura; y en las 13 superficies de B2 eliminar la bandera `*Failed` y su aviso (el componente
`LoadError` sigue siendo usado por los listados de v1.7.0, no borrarlo).

### 6.12 Prospectos con todo mensaje entrante y «Citas» creada a mano (21-10-2026)

Segundo reporte del dueño sobre la misma pantalla: *«resuelve el apartado Prospectos, si tengo»* y
*«prospectos: no solo agenda número, sino todo mensaje entrante»*. Captura con el contador en 0
habiendo un hilo de Messenger abierto. Dos cosas distintas, y había que separarlas.

**Causa 1 — la de la captura: el 500 de §6.9 sigue en producción.** No es un bug nuevo: el arreglo
(`isoDate()` + el aviso de «lista no disponible») está en el árbol desde §6.9 y §6.11 pero **no
desplegado**; `eeb9443` todavía hace `row.firstInboundAt?.toISOString()` y su cliente todavía pinta
`Aún no hay prospectos` cuando la llamada falla. Medido en la VM: 21 mensajes `in`, 5 hilos reales,
y el SQL de la pantalla devuelve filas — o sea los datos están bien y lo que falta es la versión.

**Causa 2 — la de fondo, y sí era nueva: el correo entrante no existía para Prospectos.** Medido
en producción: 16 `email_message` con `direction = 'inbound'` de **10 remitentes distintos**, con
`contact_id` en NULL en los 16 (la ingesta de `server/email/service.ts:191` lo deja fijo en `null`
a propósito). Como la pantalla se derivaba solo de `message`, esas 10 personas eran invisibles: no
estaban en Prospectos porque nunca escribieron por chat y no estaban en Contactos porque no tienen
ficha. Eso es exactamente lo que el dueño pidió ver aquí.

- **Arreglo**: `listProspects` ahora fusiona dos lecturas —`listChatProspects` (igual que antes) y
  `listEmailProspects` (`email_message` agrupado por `from_email`)— ordenadas por el último mensaje
  entrante, con el mismo corte de 200. El correo **no** se metió en el catálogo `Channel` (no tiene
  hilo en Bandeja ni agente) sino que trae su etiqueta de pantalla, `Correo`.
- `ProspectDto.contactId` y `.conversationId` pasan a ser nullables y se agrega `.email`. No es un
  adorno del tipo: un remitente de correo **no es un contacto** hasta que el dueño lo da de alta, y
  fingir un `contactId` sintético habría enlazado la fila con una Bandeja que no existe.
- La tarjeta enlaza con `/email` y muestra la dirección cuando no hay ficha; con `/inbox?contact=`
  cuando sí. El filtro «Con teléfono» y «Ver archivados» se saltan entera la lectura de correo (un
  remitente no puede cumplirlos) y un canal de chat también la salta.
- **Se deja a propósito sin dedup**: alguien que escribió por chat y por correo sale dos veces, una
  por canal. El contacto no guarda correo, así que fundirlos sería adivinar, y borrar una fila real
  es la misma clase de error que §6.10.
- **No se tocó**: `email_message.contact_id` sigue en NULL. Dar de alta contactos en la ingesta
  cambiaría Contactos, que desde §6.7 cuenta **solo la cartera** — mezclar las dos cosas era peor
  bug del que se salía.

**Y «Calendario» pasa a llamarse «Citas»**, con alta manual. La API ya la soportaba desde 015
(`kind: "session"`, `source: "manual"`, `requireOffer: false`); lo que faltaba era la pantalla, que
solo ofrecía «Bloquear un rango». Ahora hay sección **Nueva cita**: contacto (`ContactPicker`, que
lee `/api/contacts` sin `won=1` para poder elegir a un prospecto), hueco de la disponibilidad o
hora impuesta, y nota. El renombrado vive en `config/nav.ts` —de ahí se pintan la barra lateral, el
breadcrumb y el ⌘K a la vez— más el `h2` de la página. La pestaña de Ajustes sigue siendo
«Calendario», que es donde se configura el horario, y el aviso de citas vacías lo dice.

- **El servidor sigue mandando**: una hora impuesta fuera de jornada o ya ocupada vuelve
  `slot_taken` y se muestra tal cual. No se aflojó la REGLA 2 ni se inventó un hueco para que el
  botón siempre funcionara.
- `citaStartUtc()` existe porque el `datetime-local` del navegador escribe la hora **sin zona**: si
  ese texto viajara crudo, el servidor la leería como UTC y la cita caería 6 horas antes en
  Ciudad de México. Está probado contra el constructor de hora local, no contra una cadena fija,
  para que la prueba valga igual en el CI (UTC).
- La disponibilidad ya no se recorta a 12 en el estado: se guardan todos los huecos (el selector de
  alta los necesita) y el de reprogramar sigue mostrando 12.

Gates: `db:guard` (0 avisos, **sin migraciones nuevas**), `typecheck`, `lint`, `pnpm test`
**153 archivos / 1464 pruebas** (antes 152/1453) y `next build`, todos en verde. Pruebas nuevas en
`tests/unit/prospects-query.test.ts` (7 del correo: fusión, orden por fuente, tenant + `inbound`,
los tres saltos de filtro y el `%` escapado en la dirección) y `tests/unit/cita-alta-manual.test.ts`
(4 del instante). La prueba que decía «sin prospectos no consulta las oportunidades» ahora cuenta
dos lecturas y exige que la que NO se haga sea la de `lead`.

Verificado contra datos reales (SQL de solo lectura en el contenedor, tenant `org_q5s3`): la
pantalla pasaría de 0 a **11 filas** —1 de Messenger (Axel, 6 entrantes) y 10 remitentes de correo
con su último asunto—, y Honeycat conserva sus prospectos de chat (0 de correo).

Nada de esto está commiteado ni desplegado. Deshacer: borrar `listEmailProspects` y
`serializeEmailProspect` y devolver `listProspects` a ser la consulta de chat; quitar `.email` y
volver a no-nullable `contactId`/`conversationId` en `ProspectDto` (el cliente vuelve a su `key` y
`href` de siempre); y en Citas, quitar la sección «Nueva cita» y el `import { ContactPicker }`,
devolver `label: "Calendario"` en `config/nav.ts` y el `h2` de la página.

### 6.13 El rail lateral recortaba la última pestaña y ocultaba el avatar (21-10-2026)

**Síntoma visto por el dueño:** en Ajustes → Conexiones el ícono de abajo de la
barra se ve «entrecortado» y el avatar (gato/perro/león/zorro o las iniciales)
no aparece.

**Causa, medida y no suposición.** El `<aside>` de `src/components/app-nav.tsx` es
`lg:overflow-visible` y vive dentro de un shell con `h-dvh overflow-hidden`. Su
contenido mide ~938 px: 17 renglones de 44 px + 2 de separación (780), el logo con
sus márgenes (66), el bloque de cuenta (56), la insignia de versión (22) y el
`padding-bottom` (14). En una ventana de 801 px de alto, nada de eso cabe y como el
aside no recorta, recorta el shell: la última pestaña (Ajustes) termina 24 px más
abajo del borde y el avatar y la versión quedan **enteros** fuera de la pantalla.
Reproducido en un arquetipo con la misma geometría: sin scroll, `gearBottom` 825 y
`avatarBottom` 873 contra un borde en 801 → al avatar le quedaban **0 px visibles**.

**Arreglo.** El `nav` es ahora la única región con scroll del rail
(`min-h-0 flex-1 overflow-y-auto`, sin barra visible porque el rail mide 72 px) y
se quitó el `<div className="flex-1" />` que hacía de separador: el propio `nav`
crece. Logo, avatar y versión quedan anclados y siempre a la vista; medido en el
mismo arquetipo: avatar en 760 y versión en 787, dentro de los 801.

**Por qué el tooltip cambió de dueño.** Un contenedor de scroll recorta todo lo que
asoma de su caja, incluidos los globos que salen a la derecha del rail, que es
justo donde el menú necesita desplazarse. El globo dejó de ser hijo del enlace y
pasó a ser hijo del `<aside>` (de `lg:static` a `lg:relative`), posicionado con
`tooltipTop()` sobre el centro del renglón. Verificado con hit-test en el
arquetipo, no por apariencia: dentro del nav `elementFromPoint` respondía el fondo
(`pintado: false`); como hijo del aside respondió el propio globo (`pintado: true`).
Misma razón por la que el bloque de cuenta usa el mismo mecanismo.

**Hallazgo colateral, arreglado.** `tests/unit/version.test.ts` anclaba con
`nav.indexOf("versionLabel()")`, una cadena que **no existe** en el archivo: el
`indexOf` devolvía −1 y el `slice` terminaba siendo «la cola del archivo». Pasaba
porque la insignia era lo último del fichero; cualquier cosa añadida después lo
rompía. El anclaje ahora busca `versionLabel(sha)` y el test exige que el anclaje
exista, para que no vuelva a pasar desapercibido.

**Barrido de la misma clase (Regla del «sigue»).** `grep overflow-visible` sobre
`src/` deja un solo candidato más: el sub-nav de Ajustes
(`settings/settings-nav.tsx:76`), con `sm:overflow-visible` en columna. **No se
tocó, y este es el porqué:** 9 pestañas + 2 etiquetas de grupo dan ~480 px contra
~735 px disponibles en la misma ventana; cabe con 255 px de margen. Es el mismo
patrón y volverá a recortar si Ajustes crece ~6 pestañas más, así que queda
anotado aquí en lugar de «por si acaso».

**Pruebas.** Gates completos: `db:guard` (0 avisos, sin migración nueva),
`typecheck`, `lint`, `build` en verde y **154 ficheros / 1467 tests** (3 nuevos de
`tooltipTop`). **No** hay verificación en la app real: sin BD local ni sesión, y la
producción aún no tiene este cambio. Lo afirmado arriba es geometría medida en el
arquetipo más inspección del CSS emitido (`scrollbar-width:none` y
`::-webkit-scrollbar{display:none}` sí salen en el bundle).

**Deshacer.** Devolver el `nav` a `flex flex-col gap-0.5 lg:items-center`,
restaurar `<div className="flex-1" />`, regresar el aside a `lg:static`, y volver a
montar `NavTooltip` dentro de cada enlace y del bloque de cuenta. Borrar
`tests/unit/nav-tooltip-top.test.ts` y devolver el anclaje de `version.test.ts`.

### 6.14 El globo del rail se pintaba detrás de la cabecera (21-10-2026)

**Síntoma visto por el dueño:** al pasar el cursor por el ícono de Contactos, la
píldora con el nombre del módulo sale «por detrás» de la cabecera; pide que siempre
se vea encima. Es la segunda ronda sobre el mismo globito: §6.13 lo sacó del `nav`
(recorte) pero no de la cabecera (apilamiento).

**Causa, y por qué el `z-50` del globo no alcanzaba.** El `<aside>` del rail lleva
`lg:translate-x-0`. Un `transform` convierte al elemento en **contexto de
apilamiento**, así que el `z-50` del globo solo ordena *dentro* del rail: afuera, el
rail competía con `lg:z-auto` (efectivamente 0). La cabecera es `sticky top-0 z-30`
y vive en el hermano que viene **después** en el DOM, dentro de una columna estática
que no crea contexto propio. Consecuencia exacta: 30 > 0, la cabecera pima. Y no era
solo la cabecera — `dashboard-client.tsx:178` tiene una barra `sticky z-10`, también
por encima del rail.

**Medido, no deducido.** Se montó el shell real (rail + columna con cabecera) sobre
la hoja de estilos **ya compilada de la app** (`.next/static/css/*.css`) y se hizo hit
test sobre el centro del globo. El truco del puntero importa: el globo lleva
`pointer-events-none`, así que `elementFromPoint` lo ignora siempre; se reactiva solo
durante la medición, porque el hit test sigue el orden de pintado y por eso responde
lo que realmente está encima.

| capa del rail en escritorio | `z-index` calculado | qué responde el hit test | globo visible |
|---|---|---|---|
| `lg:z-auto` (antes) | rail `auto`, cabecera `30` | `cabeca` | **no** |
| `lg:z-40` (ahora) | rail `40`, cabecera `30` | `globo` | **sí** |
| `lg:z-40` + diálogo `z-50` abierto | diálogo `50` | `dialogo` | no, y es lo correcto |

La hoja copiada tiene los `@media (min-width:…)` planos a `1px` porque el navegador
de prueba mide 491×593 y sin eso no entra la rama de escritorio. Tailwind emite los
bloques sm < md < lg < xl < 2xl en orden ascendente, así que el ganador por propiedad
es el mismo que en una ventana de 1536 px para las clases que se ejercitan aquí
(`lg:relative`, `lg:z-40`, `lg:overflow-visible`, `lg:translate-x-0`, `lg:w-[72px]`).
`getComputedStyle` confirmó además que el rail queda `position: relative` con
`transform: matrix(1,0,0,1,0,0)`, o sea que el contexto de apilamiento existe de
verdad y el `z-50` interno no puede salir de él.

**Arreglo.** El `<aside>` pasa de `lg:z-auto` a `lg:z-40`: arriba de la cabecera
(30) y de cualquier barra pegajosa de página, abajo de los diálogos de página
(`z-50`, repartidos en 27 ficheros de `src/`) y del ⌘K (`z-[70]`). Se eligió 40 y no
50 para no tapar un diálogo abierto, y se dejó el `z-50` base del drawer móvil
intacto (ahí el rail sí tiene que quedar sobre el velo `z-40` de
`app-shell.tsx:101`).

**Barrido de la misma clase (Regla del «sigue»).** Todo lo que desborda el rail de
72 px y está atrapado en su contexto se arregla con la misma línea, y se confirmó
superficie por superficie: el **selector de avatar** (`app-nav.tsx:260`, `absolute
bottom-full left-0 z-50 w-60`) asomaba 168 px hacia la columna de contenido y se
pintaba debajo de la cabecera igual que el globo; su **velo** (`fixed inset-0 z-40`)
no oscurecía ni la cabecera ni `main` por la misma razón. Ambos quedan bien con el
rail en 40. El otro rail con `overflow-visible` (`settings/settings-nav.tsx:76`) **no
tiene globos**: sus etiquetas son texto en flujo, así que no comparte el fallo. La
cabecera tampoco aporta candidatos: `app-header.tsx` solo monta migas, el botón de
búsqueda, la campana y `ThemeToggle`, y este es un botón que alterna el tema sin
capa flotante (`theme-toggle.tsx:26`). En Bandeja, el panel de contacto usa
`max-xl:z-40` (empata con el rail y gana el orden del DOM) pero está anclado a
`right-0` con 320 px de ancho, lejos de la columna x<72: sin solape, sin cambio de
comportamiento.

**Prueba nueva.** `tests/unit/rail-stacking.test.ts` (4 casos) fija la invariante
leyendo las dos fuentes: el rail declara `lg:z-<n>` numérico (nunca `auto`), `n` es
mayor que el `z` real de la cabecera y menor que 50; el globo sigue siendo hijo del
`<aside>` con `lg:relative` y `lg:overflow-visible`. Los anclajes se verifican con
`expect(...).not.toBeNull()` para que un cambio de forma en el JSX **falle** en lugar
de quedarse probando nada (el error de `version.test.ts` en §6.13). La lógica de la
guarda se comprobó contra las tres cadenas: `z-auto` → FALLA, `z-40` → PASA, `z-60`
→ FALLA. No se re-introdujo el bug en el código para probarlo.

**Gates.** `db:guard` 0 avisos (ninguna migración), `typecheck`, `lint`, `build` en
verde y **155 ficheros / 1471 tests**. Evidencia del CSS emitido:
`.next/static/css/4c64605614be8220.css` contiene `lg\:z-40{z-index:40}` junto a
`.z-30{z-index:30}`, o sea que Tailwind sí generó la utilidad nueva (el `lg:z-auto`
mencionado en el comentario del componente también se emite, inofensivo: ninguna
etiqueta lo usa). **Sigue sin haber verificación en la app real** — sin BD local ni
sesión, y nada de esto está desplegado.

**Deshacer.** Una clase: devolver `lg:z-40` a `lg:z-auto` en
`src/components/app-nav.tsx:157` y borrar `tests/unit/rail-stacking.test.ts`. El
código sigue funcionando; el globo vuelve a esconderse detrás de la cabecera.

### 6.15 Entrega v1.8.0 (21-10-2026) — los §6.8 a §6.14 pasan a producción

Instrucción del dueño: «haz el push, git y actualiza todo el código y la documentación». Todo lo
que estaba **LOCAL ONLY** desde el pase de auditoría se commitea y se sube a `main` (el push
despliega solo, vía GitHub Actions → Docker Hub → `pull` en la VM).

Qué trae esta versión, en orden de las secciones:

| § | Contenido | Migración |
|---|---|---|
| 6.8 | 13 de 15 hallazgos del audit (agente, cotizaciones, bandeja, PDF, handoff) | No |
| 6.9 | Alta manual de prospectos por el agente y fichas múltiples por turno | No |
| 6.10 | Inteligencia: las fuentes se **relacionan** con la búsqueda en vez de ocultarse | No |
| 6.11 | Cuatro clases barridas en todo el árbol: límites `NaN`, lectura-caída-estado-vacío, fechas UTC, descuento huérfano | No |
| 6.12 | Prospectos mergean el correo entrante; «Calendario» → **«Citas»** con alta manual | No |
| 6.13 | Rail lateral con scroll solo en el `nav`: avatar y versión siempre visibles | No |
| 6.14 | El globo del rail por encima de la cabecera (`lg:relative lg:z-40`) | No |

**Ninguna migración nueva**: el guard de migraciones sigue en 0 avisos y el journal en 82
entradas. SemVer **1.7.0 → 1.8.0** (menor: hay capacidad nueva para el usuario — correo como
fuente de prospectos, citas de alta manual, rail legible).

**Despliegue verificado** (Regla 3, medido dentro de la VM a las 22:50Z del 21-10-2026): CI
`Build & Push Docker Image` en verde sobre `ddb4c65` (run 39688071526, 7m54s, con `db:guard`
como primer paso), el contenedor servido lleva `org.opencontainers.image.revision = ddb4c65…`,
`/api/health` responde `{"ok":true,"version":"1.8.0","commit":"ddb4c65"}` y el arranque cierra
con `[migrate] migraciones aplicadas` + `Ready in 6.1s` sin errores. Tag **`v1.8.0`** empujado
como ancla de rollback (empujar un tag no dispara un segundo despliegue: el workflow solo mira
`push: branches: [main]` y `workflow_dispatch`).

Documentación actualizada en la misma pasada: `docs/SISTEMA-COMPLETO.md` (capítulos nuevos **§33
Inteligencia de mercado**, **§34 Agenda y Citas**, **§35 Capas del shell**, índice, y el barrido
de «Calendario» → «Citas»), `docs/DOCUMENTACION-COMPLETA-SISTEMA.md` (versión, métricas reales
recuento por `find`/`grep`, tablas `intel_*`, rutas `/api/intel/*` y `/api/prospects`, bugs 13-15,
tabla de tests y gate con `db:guard`), `README.md` (secciones Prospectos/Citas/Inteligencia y
ejemplos de versión) y esta sección.

**Correcciones de exactitud al documentar** (no eran código, eran docs): las métricas del repo
estaban heladas del 19-10 (102 tablas → **104**, 77 migraciones → **82**, 202 rutas → **207**,
135 componentes → **140**, 1086 tests/124 archivos → **1471/155**, y el `pnpm test` no dura
15.5 s sino 142 s); el listado de scripts E2E mencionaba `e2e-diseno-atlas.mjs`, **que no
existe**, y faltaban los siete reales. Lección: una métrica contada a mano caduca en cuanto
alguien añade un archivo; hay que volver a contarla, no actualizarla «a ojo».

**Qué sigue sin probarse tras el despliegue** (Regla 3):
- El recuento real de Prospectos con sesión autenticada (~11 filas en
  `org_q5s3lc9e6cpq70k8gk4d`) y que la pantalla ya no diga «0» — requiere la sesión del dueño.
- La geometría del rail y el globo en la app real — el viewport de la app de escritorio es
  491×593 y el branch `lg:` (1024 px) nunca corre ahí; se midió con CSS compilado.
- Envío real con plantilla, reconexión de Google Calendar (token aún revocado, app OAuth sin
  publicar) y las llamadas vivas a SerpApi/Apify/YouTube/DENUE.
- Revocación del PAT de GitHub pegado en el chat (**P0, sigue siendo acción del dueño**).

### 6.16 El ledger de migraciones cuenta 80 y el journal 82 (21-10-2026)

Al verificar el despliegue, un número no cuadraba: `drizzle.__drizzle_migrations` tenía **80
filas** frente a **82 entradas** del journal. Se investigó por hash del SQL (la fórmula de
`scripts/migrate.mjs`), no por `created_at`, y el resultado es que **no hay migración pendiente**:
las dos entradas sin fila son `0044_integration_credentials_encrypted` y `0062_mcp_oauth`. Las dos
están **en el esquema vivo**: columnas (`integration.credentials_cipher/iv/tag`, 3 de 3) y tablas
(`mcp_authorization_code`, `mcp_access_token`, 2 de 2). Que se aplicaron a mano es **inferencia**,
no testigo: el único modo de que el DDL exista sin fila que lo registre es haber corrido ese SQL
fuera de `migrate()`.

Por qué no se aplicaron solas al arrancar: `migrate()` no busca «¿está esta migración?», sino que
lee el **último** `created_at` del ledger y ejecuta solo las entradas con `when` mayor. Como esas
dos se insertaron con un `when` anterior al watermark que ya tenía la base, quedan excluidas para
siempre. `reconcileMigrationLedger()` corrige watermarks y purga filas huérfanas por hash, pero no
puede inventar una fila que nunca existió.

**No se actúa sobre esto** (Regla 2: sería escribir en producción para cambiar un contador que no
afecta a nada). Lo que sí queda como norma, y ya está escrito en `docs/SISTEMA-COMPLETO.md`
(§ Migraciones):

- Un `.sql` que entra tarde en la cadena se escribe **idempotente** (`IF NOT EXISTS`), porque es la
  única forma de que sea correcto aplicado y no aplicado.
- Nunca retrodatar un `when`: el guard de orden de `scripts/migrate.mjs` lo impide en el arranque y
  `pnpm db:guard` en CI, pero la razón es esta regla de watermark, no el estilo.
- Para responder «¿está el esquema al día?» no vale contar filas del ledger: hay que comparar por
  hash o mirar el objeto concreto (`information_schema`).
- Log de arranque no enumera migraciones. `[migrate] migraciones aplicadas` también se imprime
  cuando no había nada que aplicar; quien depure un despliegue buscando esa lista no la va a
  encontrar. Ya está escrito en el runbook de §6.4.

### 6.17 Pase de inyección sobre la superficie v1.8.0 (21-10-2026) — 6 hallazgos corregidos

Instrucción: analizar y proteger las vulnerabilidades de lo recién desplegado. Ningún hallazgo se
arregló a partir del resumen de un subagente: cada línea se releyó antes de tocarla, y cuando una
clase de defecto se repetía se barrió el repo entero (regla «sigue»), registrando el motivo de cada
ruta omitida.

**S-1 (alta) — el MIME del adjunto lo elige quien lo envía.** `/api/media/[assetId]` servía
`asset.mimeType` tal cual y con `inline`. Ese valor nace fuera: `media.mime_type` del payload del
webhook (`src/server/inbox/ingest.ts`) o el `content-type` de la respuesta remota
(`src/server/whatsapp/media.ts`). La bandeja enlaza el adjunto con `target="_blank"`, así que un
objeto `text/html` se abría como documento del propio CRM y ejecutaba con la sesión del que hace
clic. `assetViewHeaders()` ([src/server/media-path.ts](../src/server/media-path.ts)) pone la lista
blanca (`image/*` menos SVG, `video/*`, `audio/*`, PDF), `nosniff` siempre, `attachment` para todo lo
demás y el nombre saneado. **Efecto visible:** un SVG pegado en una conversación descarga en lugar de
previsualizarse, y un adjunto de tipo raro ya no se abre en la pestaña. Eso es el arreglo, no una
regresión.

**S-2 (media) — fórmulas en el CSV.** Dos serializadores escribían la celda sin mirar el primer
carácter. Excel evalúa lo que empieza por `= + - @`, y por un espacio o tabulador previo más uno de
esos. Ahora hay una sola regla, `escapeCsvCell()` en [src/lib/csv.ts](../src/lib/csv.ts), usada por
el export del servidor (Contactos, Inventario) y por el del navegador
(`src/components/inteligencia/intel-export.ts`), que tenía su copia duplicada. Los números negativos
se dejan intactos: `-5` en un monto es una devolución, y convertirlo en texto rompería las sumas.

**S-3/S-4/S-5 (media) — esquemas en `href`.** `src/lib/safe-url.ts` centraliza la regla: canonicaliza
con `new URL` y compara contra `parsed.protocol`. Se midió antes de escribirla: `new URL` **elimina
tabuladores y saltos de línea**, así que `java\nscript:` se normaliza a `javascript:` y cualquier
filtro de prefijo sobre el texto crudo la deja pasar. Cerró tres sumideros: el import CSV del catálogo
(escribía `website_url` crudo mientras POST/PATCH/MCP ya validaban), `meetingLink` de Citas (`normalizeLink`
solo recortaba y la ruta es `withAuth`: cualquier miembro podía envenenar el clic de otro), y los
`href` armados a mano en Proveedores. De 29 sumideros `href` revisados, 3 estaban crudos.

**S-5/S-6 (baja) — la clase que ya se había cerrado a medias.** En el mismo barrido: `ilike` con `%`
sin escapar en Proveedores (`?q=%` barría la tabla), `Number(rating)` produciendo `NaN` y un 500 que
la pantalla leía como «sin proveedores», y cuatro rutas más con `limit` sin respaldar
(`/api/quotes`, `/api/email/threads`, `/api/settings/webhooks/[id]/deliveries`,
`/api/settings/capi/events`). `escapeLike` estaba privado en `src/server/ai/inventory.ts`; se extrajo
a [src/lib/db/like.ts](../src/lib/db/like.ts) para que las dos búsquedas no puedan divergir.

Estado de los datos: en la producción real **0 filas** de `catalog_product.website_url` empiezan por
algo distinto de `http`. S-3 y S-4 son preventivos, no remediación.

Pruebas: 5 archivos, 38 casos ( [`safe-url`](../tests/unit/safe-url.test.ts),
[`media-asset-headers`](../tests/unit/media-asset-headers.test.ts),
[`csv-formula`](../tests/unit/csv-formula.test.ts), [`suppliers-query`](../tests/unit/suppliers-query.test.ts),
[`href-injection-sites`](../tests/unit/href-injection-sites.test.ts) ). El último ancla la **fuente**:
si alguien vuelve a poner el `href` crudo en uno de los componentes, la prueba falla aunque el arreglo
original siga intacto. Gates: 1509 pruebas, `typecheck`, `lint` y `build` en verde.

**Queda abierto, y es decisión del dueño:**

- Subir `next` (15.5.20 → ≥ 15.5.24) y `nodemailer` (6.10.1, dep directa con aviso). Se midió qué
  viaja en la imagen: el runner es `standalone` y lleva solo esos dos; los 6 avisos críticos del
  `pnpm audit` (vite, vitest, tinypool, shell-quote) son de desarrollo y **no están en producción**.
  `drizzle-orm` pide un salto de 7 menores: no se toca sin una corrida completa y autorización.
- **D-01**: la ruta de WAHA responde 200 siempre y lee la tabla completa de `waha_credentials` antes
  de comparar el token. La comparación ya es con `safeEqual` sobre un HMAC derivado, así que no es una
  fuga inminente; arreglarlo bien cambia el contrato con el proveedor.
- Rate limiting: las superficies autenticadas internas no llevan limitador. Se verificó que lo que
  quema presupuesto ajeno ya está acotado (`checkRateLimit` en webhooks y login, cuota mensual por
  organización en SerpApi, caché y `rateLimitedFetch` en Google Trends).
- Lo de siempre y fuera del código: rotar el PAT pegado en el chat, reducir el ámbito del token de
  `gh`, `META_APP_SECRET` vacío y falta de respaldo fuera de la VM.

### 6.18 «Borrar prospectos» — descartar reversible (22-10-2026, migración 0083 SIN aplicar en producción)

Petición del dueño sobre la pantalla de Prospectos (11 tarjetas, 9 de ellas remitentes de
correo como `bot1@syscom.mx`): que pueda quitarlas de la lista. Preguntado el alcance, eligió
**descartar reversible**, no borrar.

**Por qué no cabía un borrado.** Prospectos no es una tabla: es una agrupación de mensajes
entrantes (`server/prospects/query.ts`). «Borrar el prospecto» habría significado borrar la
conversación de un cliente real. Y los 9 que motivaron el pedido **no tienen fila que borrar**:
la ingesta de correo deja `email_message.contact_id` en NULL a propósito, así que tampoco
existía un `archived_at` donde apoyar la marca. De ahí la tabla nueva en lugar de una columna.

**Lo que se hizo.** `prospect_dismissal` (`kind`, `key`, `dismissed_by`) con índice único
`(organization_id, kind, key)`; `POST`/`DELETE /api/prospects/dismiss` (`withAuth`); la consulta
excluye con `not in` las claves marcadas y las muestra con `(descartado)` cuando se piden los
ocultos. Sin FK a `contact`/`user`: una cascada resucitaría al descartado. El `DELETE` se resuelve
por query, no por body, como `DELETE /api/caltodo/tasks?id=`.

**Dos decisiones que cambian lo que se ve** (no son sutilezas, hay que decirlas):

- Un remitente de correo descartado **no vuelve a aparecer aunque escriba**: la clave es su
  dirección, no el mensaje. Es el comportamiento pedido —limpiar la lista de `bot1@…`—, y es la
  razón de que el botón sea «Restaurar» y no «mostrar otra vez».
- La casilla pasó a llamarse **«Ver archivados y descartados»** y ahora el `archived=true` sí
  recorre el correo (antes se saltaba la rama entera). Sin ese cambio no habría forma de
  restaurar un remitente, porque no tiene ficha.

**Arreglo de una clase ya conocida, de paso.** La tarjeta armaba el enlace con
`mailto:${encodeURIComponent(p.email)}` sobre el `From:` de un mensaje entrante —dato ajeno—.
El `encodeURIComponent` rompía el enlace (codificaba la `@`) y a la vez no era la regla del repo:
ahora pasa por `mailtoHref()` (`src/lib/safe-url.ts`), que rechaza la forma inválida y pinta texto
plano.

**Efecto en las pruebas.** La lectura de descartes rompe la suposición del mock de
`prospects-query.test.ts`, que repartía filas por **orden** de `select()`: 23 casos fallaron. El
arnés ahora identifica la consulta por su tabla (`from(prospect_dismissal)`) y resuelve los
descartes por `kind`, así que las 27 pruebas previas no tuvieron que intercalar filas vacías ni
re-numerarse. 20 casos nuevos (13 de servicio y ruta, 7 anclados a la fuente del componente y de
la ruta). Gates: 1537 pruebas, `db:guard`, `typecheck`, `lint` y `build` en verde.

**Pendiente (Regla 3 — no verificado en vivo):**

- La migración **0083 no está aplicada en producción**; la pantalla todavía no puede usarse
  desde ahí. Requiere respaldo previo + autorización explícita (§6.16: el `when` del journal es
  watermark, y 0083 entra con `when` creciente, así que `migrate()` la aplicará sola al
  desplegar — eso es precisamente lo que hay que autorizar, no dejarlo colar).
- El comportamiento de la tarjeta (Descartar → la tarjeta se va; casilla marcada → `(descartado)`
  con Restaurar) está probado con mocks y anclajes de fuente, **no** visto en un navegador.
- Commits locales de este lote: sin `push`. Los 6 commits de seguridad de §6.17 siguen esperando
  la misma autorización, y el push los despliega juntos.


### 6.19 Inteligencia: que cada panel declare su relación con la búsqueda (22-10-2026, sin migración)

Tercer reporte del dueño con la misma clase de queja: «estas siguen mostrando datos que no son
referente a mis busquedas». Capturas: el selector DENUE con tres nichos (Smartphones, Accesorios
de celular, Redes y conectividad) y todos los estados en `≥10`; la franja «Enfócate en:
Smartphones, Accesorios de celular»; y «Interés comparado» mezclando la consulta con esos nichos.

**Causa exacta.** `rankTerms` descartaba todo término con score 0 (`if (score <= 0) continue`),
`getTrends` solo devuelve nichos con snapshots GT, y `GtRanking` pintaba la franja verde con los
A/B **sin mirar la consulta**. Para una búsqueda sin palabras en común con el catálogo con serie
(«camara de seguridad» frente a esos tres nichos), no quedaba ninguna etiqueta y los paneles
parecían su resultado. La decisión anterior —ocultar el explorador (tarea #92)— ya se había
revertido porque vaciaba la pantalla; esta vez se **relaciona**, no se esconde.

**Lo que se hizo.** `rankTerms` devuelve **todos** los términos (score 0, `via: ""`);
`analyzeKeyword` pasa el catálogo completo en `catalogMatches`; `src/lib/intel-relation.ts`
etiqueta (`es tu búsqueda` / `N% parecido` / `sin palabras en común`) sin importar la base de
datos; preámbulo con «Monitorear «q»» (acción explícita, una ingesta GT); franja verde solo para
el exacto y bloque neutro con el más cercano cuando no lo hay; chips en ranking y tarjetas;
leyenda de la comparativa; `note` en subregiones y temas/consultas; mapa DENUE con opciones
etiquetadas, conteo nacional de la consulta ya pagado (`competition`), aviso de censura total y
nota de que el desglose de 32 estados solo existe por nicho; «N de M» en Tendencias actuales.

**Límites que se dejan escritos (Regla 3):**

- El mapa por estado de una consulta no monitoreada sigue sin calcularse solo: 32 llamadas por
  término. Tampoco se lanza YouTube en vivo por consulta (100 unidades). El panel lo dice y
  ofrece el camino (Monitorear + Calcular mapa).
- `CompareView` no recibe la relación: compara nichos elegidos a mano por el dueño, no un
  resultado de la búsqueda.
- `getTrends` sigue excluyendo nichos sin snapshots GT. Por eso un exacto recién monitoreado
  puede no aparecer en ranking/comparativa hasta que su ingesta termine; el ranking lo declara
  («aún no tiene serie… Pulsa «Actualizar datos»»), pero **no se ha visto en navegador**.
- «Sin palabras en común» describe el texto, no el negocio: dos nichos del mismo giro pueden no
  compartir palabras. La UI lo dice en cada pie y en el `title` de cada chip.

**Gates.** `db:guard`, `typecheck`, `lint`, 163 archivos / 1556 pruebas y `build` en verde.
Sin migración, sin push y sin tocar producción: la pantalla desplegada sigue con el
comportamiento anterior hasta que se autorice el despliegue.

### 6.20 Inteligencia: «nunca dejes vacíos» — respaldo declarado por alcance (22-10-2026, sin migración)

Cuarto reporte del dueño sobre la misma pantalla, ahora con el vacío como protagonista: «aqui
jamas dejen vacios, si sobre el nicho no hay info entonces muestra las tendencias del mismo giro
con mayor alcance, nunca dejes datos vacios». Dos capturas: «Tendencias actuales» sin una sola
fila para «camara de seguridad» (solo el aviso de que nada la menciona) y «Contenido que
funciona» en «0 de 0» con la única salida de configurar la API key de YouTube.

**Causa exacta.** El respaldo no existía: `TrendingPanel` filtraba el feed por la consulta y, con
0 coincidencias, pintaba una fila de texto; `ContentPanel` trataba «0 coincidencias» como
`outOfScope` y «sin videos» como `empty`, y en ambos casos devolvía solo un párrafo. Había datos
reales en la base (431 tendencias del país el 21-10, 37 videos de 7 días, 60 relacionados GT de
«Cámaras de seguridad») que la pantalla no usaba.

**Lo que se hizo.** `src/lib/intel-fallback.ts` (puro, client-safe) implementa la cadena
`consulta → mismo-giro → catalogo → pais` con las filas ya leídas y ordena los niveles de
respaldo por volumen («mayor alcance»); cada fila lleva el nicho y la palabra que la delata, y el
CSV añade `relacion`. `catalogMatches` viaja con `keywords` (misma lectura, coste cero) y
`CatalogMatch.keywords` es opcional para respuestas antiguas. `getContentInsights` devuelve
`fallback: "sample"` con la muestra completa y `matchedVideos: 0` cuando la consulta no aparece
en ningún video; `ContentPanel` declara ese respaldo y, si no hay ni un video capturado, pinta
las señales de Google Trends ya cargadas (`buildContentSignals`: nicho exacto + `overview.market`,
deduplicadas, alzas primero) en vez de una caja de instrucciones.

**Límites que se dejan escritos (Regla 3):**

- El respaldo no inventa parentesco: «mismo giro» exige palabras en común entre nombres/keywords
  del nicho principal y del otro nicho. Sin eso se pasa al nivel siguiente, que se declara.
- Las filas de respaldo son las ya ingeridas en la ventana; no se consulta el feed en vivo ni se
  buscan videos por consulta (100 unidades de cuota). Si no hay **ninguna** fila ingerida, el
  panel dice que no hay datos y cómo poblarlos: no hay fuente real que mostrar.
- `GtRelatedPanel` sigue ocultándose cuando el nicho activo no tiene temas ni consultas; no hay
  caja vacía y esos datos ya se muestran para la búsqueda en vivo. `GtRegionPanel` y `GeoPanel`
  siempre renderizan su declaración.
- La verificación visual de ambos paneles con una búsqueda sin coincidencias **no se ha hecho en
  navegador**; sí hay tests de las funciones puras y del servidor de contenido.

**Gates.** `db:guard`, `typecheck`, `lint`, 164 archivos / 1568 pruebas y `build` en verde.
Sin migración, sin push y sin tocar producción: la pantalla desplegada sigue con el
comportamiento anterior hasta que se autorice el despliegue.

### 6.21 Inteligencia: el documento scrolleable dejaba un vacío bajo el shell (22-10-2026, sin migración)

**Síntoma visto por el dueño:** dos capturas de `/inteligencia` a 2000 px de ancho. Al hacer
scroll, el rail queda reducido a Copiloto y Ajustes, su fondo gris termina a media página, la
cabecera desaparece y debajo del contenido aparece una franja blanca de unos 2000 px. La
instrucción fue «repara ese bug en inteligencia, scrolleando se ve asi, solucionalo».

**Lo que miden las capturas.** Hay **dos** barras verticales: la del scroller interno de
Inteligencia y la del documento. Con las posiciones de sus pulgares, el documento mide
~3075-3131 px contra 1088 de ventana, con `scrollY` ≈ 683-763; el scroller interno está en su
final y el excedente (~2000 px) es **constante entre las dos capturas** aunque el contenido
visible cambia. La cabecera y el rail están fuera de pantalla porque el documento los arrastró,
no porque el shell haya crecido: el contenido termina exactamente en el borde inferior del shell.

**Lo que NO era (medido).** El shell ya es `flex h-dvh overflow-hidden` con scroll interno por
panel. En Chrome limpio a 2000×1088, un shell con un scroller interno de 2988 px da
`docScrollHeight = 1088` y 12 eventos de rueda dejan `scrollY = 0`. El barrido estático de los
componentes de Inteligencia no encontró `h-screen`/`100vh`/`fixed` ni cajas de altura grande; el
CSS de autenticación y los layouts tampoco tocan la altura del documento. Es decir, el DOM de la
app **no** alarga el documento: confirmado por medición, no por inspección.

**Lo que sí lo reproduce (mecanismo confirmado).** Inyectar una caja en flujo de 2000 px en
`<body>`, fuera del shell: el documento pasa a 3088 px y, al agotar el scroller interno (1956 de
1956), la rueda encadena y deja `docScrollY = 2000` con el rail y la cabecera fuera de pantalla:
el síntoma exacto de las capturas. `overflow: hidden` solo recorta descendientes cuyo bloque
contenedor está dentro del shell; una caja hermana o exterior alarga el documento igual, y el
encadenamiento de rueda la alcanza. El origen concreto en el navegador del dueño (extensión o
nodo inyectado) **no está identificado**: no hay sesión autenticada local y la norma prohíbe
sondear producción desde el Mac. Clasificación Regla 3: mecanismo *confirmado mediante pruebas*;
identidad del extensor, *hipótesis pendiente* y externa a la app.

**Arreglo, en el cascarón y no en Inteligencia.** La raíz del shell lleva la clase `app-shell` y
`globals.css` bloquea el documento solo mientras el shell está montado:

```css
html:has(.app-shell) { overflow: hidden; overscroll-behavior: none; }
```

Declarativo: aplica antes de hidratar, se libera solo al desmontarse el shell (login y landing
conservan su scroll) y no depende de JS ni de portales. Se descartaron: candado por JS en un
efecto (parpadeo al hidratar y difícil de probar en Vitest con entorno `node`), shell en
`position: fixed` (deja la barra del documento activa) y candado global de `html`/`body` (rompe
las rutas públicas).

**Verificación en navegador (Playwright con Chrome del sistema, 2000×1088).** Con la caja de
2000 px presente: `html` calcula `overflow: hidden`, el documento reporta 3088 px, 18 eventos de
rueda dejan `scrollY = 0`, el scroller interno llega a 1956/1956 y el rail se queda en `top: 0`.
En `/login`, sin shell, `html` calcula `overflow: visible`. Esto prueba el mecanismo en un
navegador limpio; **no** es la página real autenticada, que sigue sin poder verificarse en local.

**Guardia.** `tests/unit/app-shell-scroll-lock.test.ts` (3 pruebas) lee las fuentes: la raíz
conserva `app-shell` junto a `h-dvh`, la regla conserva `overflow: hidden` y
`overscroll-behavior: none`, y toda regla de `<html>` con `overflow: hidden` debe estar
condicionada a `:has(.app-shell)` para que nadie la vuelva global y deje sin scroll al login.
Es estática porque el entorno de Vitest es `node`, sin DOM.

**Gates.** `db:guard` 0 avisos, `typecheck`, `lint`, **165 archivos / 1571 pruebas** y `build` en
verde. Sin migración, sin push y sin tocar producción.

**Deshacer.** Quitar `app-shell` de la raíz en `src/components/app-shell.tsx`, borrar la regla
`html:has(.app-shell)` de `src/app/globals.css` y borrar
`tests/unit/app-shell-scroll-lock.test.ts`. La app sigue funcionando; el vacío reaparece si una
caja ajena vuelve a alargar el documento.

### 6.22 Módulo Sucursales: inventario por sucursal (22-10-2026, migración 0084 SIN aplicar)

**Lo pedido.** «Crea otro módulo llamado sucursal… manejar un control relacionado de inventario
… cantidades de las piezas en diferentes sucursales … agregar los datos de la sucursal y
enlazarle los productos y inventario disponible por sucursal para llevar un control de cantidad
de producto se encuentra en qué sucursal.»

**Decisión de diseño.** El stock del catálogo (`catalog_product.stock`) ya tiene dueños
(cotizador y agente) y semántica comercial; el conteo por sucursal es un control físico distinto.
Se modela aparte (`branch`, `branch_inventory`) y **la pantalla nunca escribe el stock general**.
Un renglón por producto y sucursal (`unique(branch_id, product_id)`), cantidad `0..1_000_000`;
`0` significa enlazado y agotado, no «sin dato». Borrar la sucursal arrastra su inventario por
FK en cascada; borrar el producto lo desenlaza.

**Alcance entregado (local).** Migración `0084_branches.sql` idempotente + journal `idx: 84`;
servicio con agregados `count`/`sum` en SQL y upsert `onConflictDoUpdate`; tres rutas API
(`/api/branches`, `/api/branches/[id]`, `/api/branches/[id]/inventory`) con `withAuth` y
`scoped(...)`; pantalla `/branches` con alta/edición/baja de sucursal, enlace de productos,
cantidad por sucursal, quitar enlace y `LoadError` en fallos; entrada «Sucursales» en
`nav.ts`. Todos los ids ajenos a la organización responden 404 antes de cualquier escritura.

**Verificación.** `tests/unit/branches.test.ts` (10 pruebas) cubre límites, no-escritura con
sucursal/producto de otra organización, forma del upsert, parámetros de los `delete`, `withAuth`
en las rutas, `scoped` en el servicio y la entrada de navegación. Gates: `db:guard` 0 avisos,
`typecheck`, `lint`, **166 archivos / 1581 pruebas**, `build` con las cuatro rutas de sucursales
en el manifiesto. **No se verificó la pantalla autenticada en navegador** (sin sesión/BD local);
clasificación Regla 3 para la UI viva: *pendiente de acceso*.

**Deuda abierta.**
- La migración **0084 no está aplicada** en producción (igual que la 0083). Aplicarla exige
  respaldo previo y autorización explícita; el push a `main` despliega código, pero las
  migraciones se aplican aparte en la VM.
- El enlace de producto usa `/api/catalog?limit=500`; un catálogo mayor no es seleccionable
  desde la pantalla (la API de inventario por sucursal sí acepta cualquier producto por id).
- El conteo por sucursal **no descuenta al vender** ni se concilia con el stock general; un
  traspaso entre sucursales es edición manual de dos cantidades. Es lo que se pidió (control),
  no un motor de almacén.

**Deshacer.** Ver §36 de `docs/SISTEMA-COMPLETO.md`. Con la migración sin aplicar basta borrar
los archivos del módulo; si ya se hubiera aplicado, `DROP TABLE branch_inventory` antes de
`DROP TABLE branch`.
