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

Hoy la suite local es 129 archivos / 1123 pruebas (`pnpm test`), y producción responde
`{"ok":true,"version":"1.3.0","commit":"53f38c0"}` en `/api/health`. Los probes de regresión de
A-01 se corren **dentro** del contenedor `crm-lumarketing-caddy-1` contra `http://app:3000`
(HTTPS desde la VM no sirve: se hairpina y devuelve `code=000`): una ruta con `%2e%2e%2f` debe dar **422**,
un archivo inexistente **404**, y un logo real 200 con `nosniff`.

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
