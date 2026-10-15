# 05. Manual del backend y la API

## 1. Organización

El backend HTTP está compuesto por Route Handlers de Next.js bajo `src/app/api`. La lógica de negocio se organiza en `src/server`; los tipos, validación, auth, cifrado, configuración y acceso a datos están en `src/lib`.

## 2. Patrón observado

~~~mermaid
flowchart TD
  A[Solicitud HTTP] --> B[Route Handler]
  B --> C{¿Ruta protegida?}
  C -->|sí| D[withAuth / sesión]
  C -->|no o webhook| E[Validación propia]
  D --> F[Validación de entrada]
  E --> F
  F --> G[src/server]
  G --> H[Drizzle / PostgreSQL]
  H --> I[JSON / status HTTP]
~~~

No todas las rutas tienen el mismo patrón. Webhooks, mocks de desarrollo y health check requieren lectura individual. Nunca se debe dar por hecho que un endpoint está protegido solo porque otra ruta vecina use `withAuth`.

## 3. Endpoints verificados directamente

| Endpoint | Método observado | Comportamiento identificado |
|---|---|---|
| `/api/health` | GET | `SELECT 1`; 503 con `db_unavailable` si no hay DB. |
| `/api/pipeline/board` | GET | Lee etapas y leads con `scoped(..., session.organizationId)`; une datos de contacto y conversación. |
| `/api/quotes` | GET, POST | Lista cotizaciones y crea nueva con esquema de entrada Zod. |
| `/api/commercial/campaigns` | GET, POST | Lista/crea campañas comerciales limitadas a la organización. |
| `/api/analytics/dashboard` | GET | Lee configuración de integraciones Meta Ads, Google Ads y GA4 para formar el dashboard de analítica. |

Archivos base:
- `src/app/api/health/route.ts`
- `src/app/api/pipeline/board/route.ts`
- `src/app/api/quotes/route.ts`
- `src/app/api/commercial/campaigns/route.ts`
- `src/app/api/analytics/dashboard/route.ts`

## 4. Familias de API identificadas

El árbol de código contiene 181 archivos `route.ts`. Las familias visibles incluyen:

| Familia | Ejemplos de endpoint |
|---|---|
| Auth/sesión | `/api/auth/[...all]` |
| Salud | `/api/health` |
| Dashboard/analítica | `/api/dashboard`, `/api/analytics/dashboard`, `/api/analytics/ga4/test` |
| Conversaciones/mensajes | `/api/conversations`, `/api/events` |
| Contactos | `/api/contacts`, `/api/contacts/[id]`, import/export |
| Pipeline | `/api/pipeline/board`, `/api/pipeline/leads`, `/api/pipeline/stages`, `/api/pipeline/stats` |
| Cotizaciones/cargos | `/api/quotes`, `/api/quotes/[id]`, `/api/charges`, `/api/expenses` |
| Comercial | `/api/commercial`, `/api/commercial/campaigns`, `/api/commercial/service-costs`, `/api/commercial/marketplace-orders` |
| Catálogo/proveedores | `/api/catalog`, import/export/send, `/api/suppliers` |
| Proyectos/tareas | `/api/projects`, `/api/tareas`, `/api/caltodo/tasks` |
| Agenda/reservas | `/api/bookings`, `/api/calendar/availability`, `/api/bot/availability` |
| Automatizaciones | `/api/automations/rules`, executions, followup |
| Difusión | `/api/broadcasts`, start/pause/preview |
| Canales y webhooks | `/api/webhooks/wa`, `/api/webhooks/ig`, Messenger, WAHA, Zernio WhatsApp |
| Integraciones/ajustes | `/api/integrations/[provider]`, `/api/settings/*` |
| Email | `/api/email/accounts`, `/api/email/messages`, threads y stats |
| Agente/Laboratorio | `/api/agent/profile`, `/api/lab/chat`, `/api/lab/runs` |
| Inteligencia | `/api/intel/*` |
| WATSI | `/api/watsi/chat`, conversaciones |

La tabla es un índice de familias, no un contrato completo de API. Los métodos HTTP, campos, códigos de respuesta y permisos de cada uno deben confirmarse directamente en su `route.ts`; la auditoría no inspeccionó de forma exhaustiva todos los 181 archivos.

## 5. Acceso a datos y tenant

- `src/lib/db/index.ts`: crea cliente `postgres.js` y Drizzle.
- `src/lib/db/schema.ts`: declaraciones `pgTable`.
- `src/lib/db/tenant.ts`: helper `scoped()`.
- `src/lib/api.ts`: utilidad de handlers/auth referenciada por las rutas revisadas.
- `src/server/diagnostics/redact.ts`: lógica de redacción de logs.

Cada nueva consulta de dominio debe usar la organización obtenida desde la sesión, validar entradas, manejar errores y probar intentos de acceso cruzado entre organizaciones.

## 6. Integraciones identificadas

El árbol del proyecto contiene código para WhatsApp Cloud API, WAHA, Zernio, Instagram, Messenger, TikTok, Meta Graph/Conversions API, Google Analytics 4, Google Business, Mercado Libre, SMTP/IMAP y proveedores de modelos de lenguaje compatibles con OpenRouter. La presencia de código cliente no acredita que las credenciales sean válidas o que la conexión funcione actualmente.

## 7. Trabajos de fondo

Existen pollers/sincronizadores para varias integraciones, colas dentro del proceso y módulos de Temporal. El `docker-compose.yml` raíz no declara un servicio Temporal dedicado. Se debe confirmar si el servicio se aloja externamente, si el worker se ejecuta por separado o si la configuración corresponde a una capacidad opcional.

## 8. Códigos, errores y logging

Usa los códigos HTTP reales del handler, no los supongas. En el endpoint de salud, la falla de base retorna 503. Al registrar errores, conserva endpoint, proveedor, tiempo y código, pero redacta tokens, cookies, credenciales, contenido de conversación y datos personales.

## 9. Validaciones previas a producción

Ejecuta los gates declarados: `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build`. Revisa el resultado de GitHub Actions para el commit y el entorno exactos. La auditoría no ejecutó pruebas ni comprobó logs de producción.
