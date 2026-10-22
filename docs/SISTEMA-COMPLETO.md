# Zorro Tech — Documentación Completa del Sistema

**Versión**: 1.7.0  
**Fecha de actualización**: 20 de octubre de 2026  
**Propietario**: Zorro Tech / Demian Soberanes  
**Repositorio**: `demiansoberanes7-stack/crm-lumarketing` (GitHub **PÚBLICO** — verificado con `gh repo view`)  
**Base**: fork de un CRM open source (MIT); el aviso de copyright original vive en `LICENSE`

> Al ser público, cualquier archivo que se sube es legible por cualquiera: nunca
> `.env`, credenciales, copias de base de datos ni artefactos con datos reales.

---

## Índice General

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Base de Datos](#4-base-de-datos)
5. [Autenticación y Multi-tenancy](#5-autenticación-y-multitenancy)
6. [Canales de Comunicación](#6-canales-de-comunicación)
7. [Sistema de Webhooks](#7-sistema-de-webhooks)
8. [Bandeja de Entrada Unificada](#8-bandeja-de-entrada-unificada)
9. [Agente de IA](#9-agente-de-ia)
10. [Laboratorio de Auto-evaluación](#10-laboratorio-de-autoevaluación)
11. [Módulo de Contactos](#11-módulo-de-contactos)
12. [Pipeline Comercial y Leads](#12-pipeline-comercial-y-leads)
13. [Cotizaciones](#13-cotizaciones)
14. [Cobranza y Cuentas por Cobrar](#14-cobranza-y-cuentas-por-cobrar)
15. [Balance General y Finanzas](#15-balance-general-y-finanzas)
16. [Proyectos y Etapas](#16-proyectos-y-etapas)
17. [Tareas](#17-tareas)
18. [Dashboard de KPIs](#18-dashboard-de-kpis)
19. [Sistema de Diagnóstico](#19-sistema-de-diagnóstico)
20. [Notificaciones en Tiempo Real (SSE)](#20-notificaciones-en-tiempo-real-sse)
21. [Webhooks Salientes](#21-webhooks-salientes)
22. [Gestión de Medios](#22-gestión-de-medios)
23. [Branding y Personalización](#23-branding-y-personalización)
24. [Configuración del Sistema](#24-configuración-del-sistema)
25. [Variables de Entorno](#25-variables-de-entorno)
26. [Despliegue en producción](#26-despliegue-en-producción)
27. [Docker y Contenedores](#27-docker-y-contenedores)
28. [Seguridad](#28-seguridad)
29. [Constitución y Reglas](#29-constitución-y-reglas)
30. [Guía de Configuración por Canal](#30-guía-de-configuración-por-canal)
31. [Troubleshooting](#31-troubleshooting)
32. [Glosario](#32-glosario)
33. [Inteligencia de mercado](#33-inteligencia-de-mercado)
34. [Agenda y Citas](#34-agenda-y-citas)
35. [Capas del shell: rail, cabecera y tooltips](#35-capas-del-shell-rail-cabecera-y-tooltips)

---

## 1. Resumen Ejecutivo

**Zorro Tech** es un gestor de comunicación y proyectos self-hosted para negocios que usan WhatsApp como canal principal con sus clientes. Nace como fork de un CRM open source (MIT) y evoluciona con identidad propia: bandeja multicanal, pipeline, proyectos, cotizaciones y un agente de IA con Laboratorio de auto-evaluación.

### Capacidades Principales

- **Multi-canal**: WhatsApp (Meta Cloud API o WAHA), Instagram, Facebook Messenger, TikTok
- **Agente de IA**: Respuestas automáticas inteligentes con OpenRouter-compatible (Groq)
- **Pipeline Comercial**: Seguimiento de leads con etapas personalizables
- **Cotizaciones**: Generación de cotizaciones con PDF y envío por WhatsApp
- **Cobranza**: Control de cuentas por cobrar con registros de pago
- **Balance General**: Dashboard financiero con ingresos, egresos y reportes PDF
- **Proyectos**: Gestión de proyectos con etapas funcionales y asignación de contactos/miembros
- **Tareas**: Buzón global de tareas con asignación y seguimiento
- **Dashboard**: 60+ KPIs con gráficas interactivas (recharts)
- **Diagnóstico**: Logs centralizados del sistema
- **Branding**: Personalización de marca (logo, colores, moneda)
- **Tiempo Real**: Notificaciones SSE sin WebSocket

### Características Técnicas

- **Arquitectura**: Monolito Next.js 15 (App Router)
- **Base de Datos**: PostgreSQL 16 con Drizzle ORM
- **Autenticación**: Better Auth con plugin de organizaciones
- **Multi-tenancy**: Aislamiento completo por organización
- **Cifrado**: AES-256-GCM para credenciales en reposo
- **Despliegue**: Docker multi-stage + docker compose en una VM de Azure, Caddy como proxy

---

## 2. Stack Tecnológico

### Frontend
| Tecnología | Versión | Propósito |
|---|---|---|
| Next.js | 15.x | Framework React (App Router) |
| React | 19.x | UI library |
| TypeScript | 5.x (strict) | Type safety |
| Tailwind CSS | 3.x | Estilos utility-first |
| recharts | 2.x | Gráficas del dashboard |
| lucide-react | 0.x | Iconografía |
| pdf-lib | 1.x | Generación de PDFs |

### Backend
| Tecnología | Versión | Propósito |
|---|---|---|
| PostgreSQL | 16 | Base de datos principal |
| Drizzle ORM | 0.x | ORM y migraciones |
| Better Auth | 0.x | Autenticación + organizaciones |
| Zod | 3.x | Validación de inputs |
| nanoid | 5.x | Generación de IDs únicos |
| EventSource (SSE) | - | Tiempo real sin WebSockets |

### DevOps
| Tecnología | Propósito |
|---|---|
| Docker | Contenedores multi-stage |
| Docker Compose | Stack de producción en la VM (app + postgres + caddy) |
| Caddy | Proxy inverso con TLS automático y log de accesos |
| GitHub Actions | `ci.yml` (calidad) y `docker.yml` (build, push, deploy por SSH) |
| pnpm | Package manager |
| Vitest | Tests unitarios |
| Playwright | Tests E2E |

### Integraciones Externas
| Servicio | Propósito |
|---|---|
| Meta Graph API | WhatsApp Cloud API |
| WAHA | WhatsApp HTTP API (self-hosted) |
| Zernio | API unificada para Instagram/Messenger/TikTok |
| OpenRouter / Groq | Proveedor de IA |
| Google Calendar | Conector de agenda |
| Zoom | Conector de agenda |

---

## 3. Arquitectura del Sistema

### Diagrama de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────┐
│                        Zorro Tech                                │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ WhatsApp │  │Instagram │  │Messenger │  │  TikTok  │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │              │              │              │              │
│       ▼              ▼              ▼              ▼              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Webhook Router                              │    │
│  │  /api/webhooks/wa/[token]                               │    │
│  │  /api/webhooks/ig/[token]  (Instagram + TikTok)         │    │
│  │  /api/webhooks/messenger/[token]                        │    │
│  │  /api/webhooks/waha/[token]                             │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Inbox Engine (src/server/inbox/)            │    │
│  │  - ingestInboundMessage()                               │    │
│  │  - sendText() / sendMediaMessage()                      │    │
│  │  - Identidad unificada (phone/ig:/fb:/tt:)              │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│       ┌───────────────────┼───────────────────┐                  │
│       ▼                   ▼                   ▼                  │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐              │
│  │ Contactos│      │Mensajes  │      │   IA     │              │
│  │  Leads   │      │ Adjuntos │      │ Agent    │              │
│  └──────────┘      └──────────┘      └──────────┘              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Cotizac.  │  │ Cobranza │  │Proyectos │  │  Tareas  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              PostgreSQL (multi-tenant)                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              SSE Event Bus (in-process)                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Patrones Arquitectónicos

#### Monolito con Boundaries Claros
El sistema es un monolito Next.js pero con boundaries claros entre módulos:
- **`src/lib/`**: Utilidades compartidas (tipos, esquemas, crypto, AI client)
- **`src/server/`**: Lógica de negocio del servidor
- **`src/app/`**: Rutas API y páginas
- **`src/components/`**: Componentes React reutilizables

#### Multi-tenancy por Organización
Cada tabla de dominio tiene `organization_id NOT NULL`. Todas las queries pasan por `scoped()` de `src/lib/db/tenant.ts` que filtra automáticamente por la organización del usuario autenticado.

#### Seguridad por Diseño
- Credenciales cifradas en reposo (AES-256-GCM)
- Tokens de WhatsApp solo muestran últimos 4 caracteres
- Webhooks verificados por segmento secreto + firma HMAC
- Rate limiting en login (10 intentos / 10 min por IP)

#### Modularidad Opcional (ADR-001)
Funcionalidades que no son core van detrás de banderas de despliegue:
- `CHANNELS=whatsapp,instagram,messenger,tiktok`
- `AGENDA=true/false`
- `ATRIBUCION=true/false`
- Módulos deshabilitados retornan 404 (indistinguibles de inexistentes)
- Las banderas también gobiernan la **superficie**: `navItemsFor({agenda})` filtra barra
  lateral, ⌘K y las pestañas de Ajustes desde el flag resuelto en el servidor
  (`agendaEnabled()` en el layout). Sin ese filtrado pasa lo que pasó con Calendario:
  `AGENDA=on` en el `.env`, la pantalla existiendo, y ni un enlace que llevara a ella.

---

## 4. Base de Datos

### Esquema General

La base de datos PostgreSQL contiene **102 tablas definidas en el modelo** (`pgTable` en
`src/lib/db/schema.ts`; en producción son 106 por las cuatro fuera de modelo de
`docs/deuda-tecnica.md` §6 D-07) organizadas en estas categorías:

#### Autenticación (Better Auth)
| Tabla | Descripción |
|---|---|
| `user` | Usuarios del sistema |
| `account` | Cuentas de autenticación |
| `session` | Sesiones activas |
| `member` | Membresías en organizaciones |
| `invitation` | Invitaciones pendientes |
| `verification` | Tokens de verificación |

#### Dominio Principal
| Tabla | Descripción |
|---|---|
| `organization` | Raíz del multi-tenancy (nombre, slug, logo, metadata JSON) |
| `contact` | Contactos multi-canal |
| `conversation` | Conversaciones por contacto/canal |
| `message` | Todos los mensajes (entrada/salida) |
| `media_asset` | Archivos binarios adjuntos |

#### Pipeline Comercial
| Tabla | Descripción |
|---|---|
| `lead` | Leads del pipeline |
| `lead_stage_event` | Historial de cambios de etapa |
| `pipeline_stage` | Etapas del pipeline comercial |

#### Cotizaciones
| Tabla | Descripción |
|---|---|
| `quote` | Cotizaciones versionadas |
| `quote_item` | Líneas de la cotización |
| `quote_event` | Historial de estados |

#### Finanzas
| Tabla | Descripción |
|---|---|
| `charge` | Cuentas por cobrar |
| `payment` | Pagos registrados |
| `expense` | Egresos registrados |

#### Proyectos
| Tabla | Descripción |
|---|---|
| `project` | Proyectos |
| `project_stage` | Etapas del proyecto |
| `project_task` | Tareas del proyecto |
| `project_stage_event` | Historial de etapas |

#### Agenda
| Tabla | Descripción |
|---|---|
| `booking` | Citas/agendamientos |
| `calendar_settings` | Configuración de calendario |
| `offered_slot` | Slots ofrecidos |

#### Canales
| Tabla | Descripción |
|---|---|
| `meta_credentials` | Credenciales Meta Cloud API |
| `waha_credentials` | Credenciales WAHA |
| `instagram_credentials` | Credenciales Instagram |
| `messenger_credentials` | Credenciales Messenger |
| `tiktok_credentials` | Credenciales TikTok |
| `whatsapp_settings` | Configuración del proveedor WhatsApp |
| `integration_secret` | Llaves HMAC para webhooks |

#### IA y Diagnóstico
| Tabla | Descripción |
|---|---|
| `agent_profile` | Configuración del agente IA |
| `agent_test_run` | Ejecuciones del Laboratorio |
| `agent_test_case` | Casos de prueba del Laboratorio |
| `diagnostic_event` | Logs de diagnóstico |
| `kb_entry` | Base de conocimiento del agente |

#### Webhooks Salientes
| Tabla | Descripción |
|---|---|
| `outbound_webhook` | Webhooks configurados |
| `outbound_delivery` | Historial de entregas |

### Índices Clave

- `contact_org_channel_identity_key`: Contacto único por org + canal + identidad
- `conversation_org_contact_test_key`: Conversación única por org + contacto (solo no-test)
- `message_wa_message_id_key`: Deduplicación de mensajes
- `charge_quote_uq`: Una carga por cotización
- `message_provider_identity_uq`: Identidad única de mensaje por proveedor

### Migraciones

La cadena completa de migraciones vive en `drizzle/` (`drizzle/0000_baseline.sql` en adelante) y se aplica **automáticamente al iniciar el contenedor**; el registro obligatorio está en `drizzle/meta/_journal.json`.

- La lista canónica es `ls drizzle/*.sql` — este documento no la duplica: ya hubo doc obsoleto que hablaba de "9 migraciones" cuando el sistema iba mucho más allá.
- Para añadir cambios de esquema: editar `src/lib/db/schema.ts` → `pnpm db:generate` → revisar el SQL generado en `drizzle/` → commitear el archivo **y** el journal.

**Cómo decide `migrate()` qué aplicar.** `Dockerfile:68` arranca `node migrate.mjs && node
server.js`; dentro, drizzle lee el journal y lo compara contra el **último** `created_at` del
ledger (`… order by created_at desc limit 1`), y ejecuta únicamente las entradas cuyo `when`
sea mayor. Es una regla de *watermark*, no un "está o no está en la tabla". De ahí dos
consecuencias que hay que saber antes de depurar nada:

- El log de arranque no enumera las migraciones aplicadas. Lo que sale en un arranque normal
  es el aviso de `CREATE TABLE IF NOT EXISTS` sobre el propio ledger y
  `[migrate] migraciones aplicadas` — que también se imprime cuando no había nada que
  aplicar. Verificar un despliegue por esa línea es comprobar que el proceso no murió.
- Un `when` **retrodatado** no se aplica jamás a una base que ya va más adelante: el
  watermark lo excluye en silencio y el esquema queda distinto al journal. Por eso el
  journal de este repo se escribe siempre con `when` estrictamente creciente:
  `scripts/migrate.mjs` aborta con `Orden de migraciones inválido en <tag>` si una entrada
  no supera la anterior, y `scripts/check-migrations.mjs` —el mismo control sin acceso a la
  BD, que corre primero en CI— reporta `journal: orden de migraciones inválido en <tag>`.

**El ledger y el journal no tienen por qué contar lo mismo.** Antes de `migrate()`,
`reconcileMigrationLedger()` (`scripts/migrate.mjs:44`) cruza cada fila del ledger con el
manifest **por sha256 del SQL**: si el hash no está en el journal la borra (fila huérfana),
y si está pero con otro `when` corrige el watermark. Su límite es lo que no puede inventar:
una migración aplicada a mano deja el esquema correcto pero **ninguna fila**, y ahí no hay
hash que reconciliar.

Medido en producción (21-10-2026, sobre `ddb4c65`): journal con 82 entradas, ledger con 80
filas, y las dos que faltan son `0044_integration_credentials_encrypted` y
`0062_mcp_oauth` — con el DDL hecho y sin fila que lo registre, que es la firma de haberse
corrido a mano (inferencia: no hay otro modo de que el esquema exista y el ledger no lo sepa).
No hay deriva: sus tres columnas
(`integration.credentials_cipher/iv/tag`) y sus dos tablas (`mcp_authorization_code`,
`mcp_access_token`) existen en la BD, y el `when` de las dos quedó por debajo del watermark
actual, así que `migrate()` ya no las mira nunca. La convención que esto obliga a sostener es
la que ya siguen: **todo `.sql` que se inserta tarde en la cadena se escribe idempotente**
(`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`), porque es la única forma de que
sea correcto tanto si se aplica como si el ledger ya lo daba por hecho.

**Journal**: `drizzle/meta/_journal.json`

---

## 5. Autenticación y Multi-tenancy

### Better Auth

El sistema utiliza **Better Auth** con plugin de organizaciones para gestión de usuarios.

#### Configuración (`src/lib/auth/index.ts`)
- **Proveedor**: Email + password (mínimo 8 caracteres)
- **Organizaciones**: Plugin `organization()` con `creatorRole: "owner"` y
  `allowUserToCreateOrganization: (user) => isInstanceOwner(user.id)`
  (`src/lib/auth/index.ts:110`). El plugin expone `POST /api/auth/organization/create`
  a cualquier sesión válida; sin ese guard un miembro de un negocio ya creado abría un
  tenant por su cuenta — y sin sembrar, porque esa ruta no pasa por
  `provisionOrganization()`. El alta legítima es la tarjeta «Negocios de la instancia»
  de Ajustes → Equipo (`src/app/api/auth/organization/route.ts`).
- **Rate Limiting**: 10 intentos por 10 minutos por IP en login/registro; el alta de
  negocio adicional usa el bucket `org-provision:<userId>` distribuido en PostgreSQL,
  así que resiste varias réplicas sin Redis.
- **Registro público**: Cerrado después de la primera organización (a menos que `ALLOW_SIGNUP=true`)

#### Hooks de Base de Datos
- **On user create**: `onUserCreated()` crea organización, membresía, etapas del pipeline, perfil del agente — **solo si la instancia está vacía**
- **On session create**: Resuelve organización activa desde membresía

#### Flujo de Registro
1. Primer usuario crea organización con advisory lock (`pg_advisory_xact_lock`)
2. Se crean 6 etapas predeterminadas del pipeline: Nuevo → En conversación → Interesado → Calificado → Cliente → Perdido (`SEED_STAGES`, `src/server/auth/on-signup.ts:9`)
3. Se crea perfil predeterminado del agente

#### Multi-negocio en una misma instancia
`ALLOW_SIGNUP=true` no mete a nadie en el negocio que ya existe: cada cuenta nueva
crea el suyo con `provisionOrganization()` (organización + membresía `owner` +
sembrado de configuración, bajo `pg_advisory_xact_lock(hashtext(userId))` para que
dos clics no generen dos tenants). Una cuenta autenticada sin negocio aterriza en
`/crear-negocio`; el shell de la app redirige allí en lugar de devolver a `/login`
(con lo cual el usuario rebotaba `/login → /inbox → /login`).

La vía sin registro público es `POST /api/settings/clients`: el **operador de la
instancia** —propietario de la organización más antigua, `isInstanceOwner()`— crea
en un solo paso la cuenta y el negocio de un cliente y entrega la contraseña
temporal. Un `owner` de negocio no puede abrir tenants ni ver el porfolio de otros,
así que `GET /api/settings/clients` solo responde desde la organización fundacional.
Con una sola organización en la instancia todo lo anterior es invisible: el
comportamiento es idéntico al de siempre.

### Multi-tenancy

#### Aislamiento por Organización
- Cada tabla de dominio tiene `organization_id NOT NULL`
- Todas las queries usan `scoped()` de `src/lib/db/tenant.ts`
- La sesión resuelve la organización desde la tabla de membresías

#### Flujo de Resolución
1. `requireSession()` retorna `{ userId, organizationId, role }`
2. `scoped()` agrega `.where(eq(table.organizationId, organizationId))` automáticamente
3. Las queries nunca pueden acceder a datos de otra organización

---

## 6. Canales de Comunicación

### Catálogo de Canales (`src/lib/channels.ts`)

```typescript
type Channel = "whatsapp" | "instagram" | "messenger" | "tiktok"

const CHANNEL_ORDER: Channel[] = ["whatsapp", "instagram", "messenger", "tiktok"]

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok",
}
```

### Capacidades por Canal (`src/server/channels/capabilities.ts`)

| Canal | Ventana 24h | Fuera de Ventana | Máximo Texto | Medios | Confirmaciones |
|---|---|---|---|---|---|
| WhatsApp | 24h | none (no se envía) | Sin límite | Sí | Sí |
| Instagram | 24h | human_agent_tag | 1000 bytes | No | No |
| Messenger | 24h | human_agent_tag | 2000 bytes | No | No |
| TikTok | 24h | human_agent_tag | 1000 bytes | No | Sí |

### Canales Habilitados (`src/server/channels/enabled.ts`)

- Variable de entorno: `CHANNELS=whatsapp,instagram,messenger,tiktok`
- WhatsApp siempre está habilitado
- `isChannelEnabled(channel)` verifica si un canal está activo
- `channelDisabledResponse()` retorna 404 si el canal está deshabilitado

---

## 7. Sistema de Webhooks

### Webhooks Entrantes

#### WhatsApp (`/api/webhooks/wa/[webhookToken]/route.ts`)
- **GET**: Handshake de verificación Meta (hub.mode, hub.verify_token, hub.challenge)
- **POST**: Autenticación en 2 capas (token + HMAC signature)
- **Procesamiento**: En `after()` para respuesta inmediata 200
- **Eventos**: `messages`, `smb_message_echoes`

#### Instagram + TikTok (`/api/webhooks/ig/[webhookToken]/route.ts`)
- **Gate**: 404 si Instagram y TikTok están deshabilitados
- **Fuentes**: Meta (`object: "instagram"`) + Zernio en la misma URL
- **Meta**: HMAC-SHA256 con `META_APP_SECRET`
- **Zernio**: Secret por cuenta resuelto desde el body. Con secreto configurado la
  firma es **obligatoria**: un evento sin `x-zernio-signature` se rechaza (antes se
  aceptaba y bastaba conocer el segmento de la URL). Sin secreto en la cuenta, la
  capa queda desactivada.

#### Messenger (`/api/webhooks/messenger/[webhookToken]/route.ts`)
- **Gate**: 404 si Messenger está deshabilitado
- **Fuentes**: Meta (`object: "page"`) + Zernio
- **Diferenciación**: `looksLikeMetaPayload()` para distinguir fuentes

#### WAHA (`/api/webhooks/waha/[token]/route.ts`)
- **POST**: Solo POST, delega a `handleWahaWebhook()`
- **Autenticación**: Token HMAC-SHA256 por organización
- **Enrutado**: el negocio se resuelve **por el token de la URL**, y la `session`
  del payload solo se contrasta como comprobación (avisa si no está registrada,
  pero no descarta el evento). El nombre de sesión no es único entre negocios:
  filtrar por él antes de verificar el token dejaba a dos tenants con sesión
  `default` sin ningún mensaje. Ver `src/server/waha/webhook.ts:224`.

### Verificación de Webhooks

#### Capa 1: Token de URL
```typescript
isValidWebhookToken(token: string): boolean
// Compara con META_WEBHOOK_VERIFY_TOKEN usando safeEqual()
```
El verify token es **común a toda la instancia** (Meta configura una sola URL de
callback por app), así que no aísla entre negocios: el aislamiento de un evento
de WhatsApp depende de la capa 2.

#### Capa 2: Firma HMAC (opcional pero necesaria en producción)
```typescript
isValidSignature(rawBody: string, signature: string | null): boolean
// HMAC-SHA256 del body con META_APP_SECRET
```
Sin `META_APP_SECRET` la capa está desactivada y **se registra un aviso una vez
por proceso** (`[webhook] META_APP_SECRET no está configurado…`); no se hace
fail-closed porque eso cortaría la ingesta de quien aún no lo configure. Con
secreto, la cabecera ausente o inválida responde 401.

#### Seguridad
- `safeEqual()`: Comparación segura contra timing attacks
- Tokens por organización: `wahaWebhookToken(orgId)` genera HMAC de `waha:{orgId}`
- Secretos de Zernio por cuenta (`webhook_secret`), no por instancia

---

## 8. Bandeja de Entrada Unificada

### Motor de Ingesta (`src/server/inbox/ingest.ts`)

La bandeja de entrada es el sistema central. TODOS los canales convergen aquí a través de un pipeline de ingesta unificado.

#### Flujo de `ingestInboundMessage()`

1. **Resolución de contacto**: `getOrCreateContactByIdentity()` crea o reconcilia el contacto
2. **Resolución de conversación**: `getOrCreateConversation()` crea o actualiza la conversación
3. **Atribución de anuncios**: Registra si hay referral presente y la feature está habilitada
4. **Inserción de mensaje**: Con idempotencia (`ON CONFLICT ON wa_message_id DO NOTHING`)
5. **Adjuntos multimedia**: Crea registro `media_asset` si está presente
6. **Actualización de conversación**: `lastInboundAt`, `lastMessageAt`, incrementa `unreadCount`
7. **Captura de teléfono**: `phone-capture.ts` intenta grabar el número que el cliente
   tecleó (append-only, nunca pisa uno existente)
8. **Actividad de lead**: `onLeadActivity()` crea o actualiza el lead
9. **Eventos SSE**: Publica `message.new` + `conversation.updated`
10. **Agente IA**: `maybeRunAgentTurn()` activa el agente

### Un hilo por persona en comentarios (`src/lib/comment-thread.ts`)

Un comentario de Instagram/Messenger/TikTok abre conversación **por publicación**, así que
la misma persona aparece en varias filas. La bandeja se pliega **al consultar**
(`foldCommentThreads`): una fila por identidad de persona (`igc:<autor>`), heredando el
total de no leídos y abriendo la más reciente; las identidades viejas que llevaban la
publicación incrustada (`igc:<post>:<autor>`) caen en la misma llave. El hilo pinta una
tarjeta por publicación (`groupCommentsByPost`) y el saliente cuelga de la publicación del
último comentario visto.

Por eso `PATCH /api/conversations` tiene una regla escrita a propósito
(`src/server/inbox/queries.ts:294`): el abanico del `markRead` a las conversaciones
plegadas **solo** corre cuando `markRead === true`. Con `markRead: false` —lo que manda
cualquier cliente del API o la acción MCP— se escribía el `updatedAt` de toda la hilera de
una persona sin limpiar nada, tocando filas que nadie pidió tocar.

### Sistema de Identidad (`src/server/inbox/identity.ts`)

#### Prefijos
```typescript
const BSUID_PREFIX = "bsuid:"  // Business-Scoped User ID
const IG_PREFIX = "ig:"       // Instagram
const FB_PREFIX = "fb:"       // Facebook/Messenger
const TT_PREFIX = "tt:"       // TikTok
```

#### Resolución de Identidad
- **WhatsApp**: Multi-campo (identity, waUserId, phone). Actualiza campos faltantes.
- **Instagram/Messenger/TikTok**: Búsqueda simple por identidad dentro del canal
- **Nombre del perfil**: Solo se actualiza si `nameSource === "perfil"` (edición del operador respeta cambios manuales)

### Envío de Mensajes (`src/server/inbox/send.ts`)

#### `sendText()`
- Pre-válida: existencia de conversación, match de tenant, guard de sandbox
- Rechaza (`SendError`) el texto que pasa de `maxTextBytes` del canal **antes de
  persistir nada**: por eso la capa del agente llama a `fitsChannel` antes de llegar aquí
- Rutea a WAHA, Instagram, TikTok, Messenger o Meta Graph según canal y proveedor
- Pre-genera ID de mensaje para envíos idempotentes de Zernio

#### `sendMediaMessage()`
- Guarda archivo en disco local primero (fuente durable)
- Sube a Graph API
- Si Graph falla post-guardado, persiste como "failed" (contenido nunca se pierde)

#### Tipos de Error
- `sandbox_violation`: Conversación de prueba intentó tocar API real
- `not_connected`: Canal no configurado
- `reconnect_required`: Reconexión necesaria
- `window_closed`: Ventana de 24h cerrada
- `meta_error`: Error de la API de Meta
- `upload_failed`: Error al subir archivo

### Ventana de 24 Horas (`src/server/inbox/window.ts`)

```typescript
const WINDOW_MS = 24 * 60 * 60 * 1000

isWindowOpen(lastInboundAt: Date, now: Date): boolean
// True si está dentro de las 24h del último mensaje entrante

windowRemainingMs(): number
// Tiempo restante (0 si está cerrada)
```

---

## 9. Agente de IA

### Configuración (`src/lib/ai/index.ts`)

El agente utiliza un adaptador compatible con OpenRouter (un solo límite LLM por Constitución II).

#### Función Principal: `chatJson<T>(schema, messages, opts)`
- Envía mensajes al proveedor LLM
- Extrae JSON de la respuesta
- Valida con Zod
- Reintenta hasta 3 veces
- Timeout por defecto: 60 segundos

#### Resolución de Configuración: `resolveAiConfig(organizationId)`
1. Consulta `agent_profile` en la BD
2. Descifra el token con AES-256-GCM
3. Retorna `{ token, model, baseUrl }` o fallback a variables de entorno

#### Extracción Robusta: `extractJson()`
- Intenta bloque de código cercado (```json)
- Intenta texto completo
- Intenta desde primer `{` hasta último `}`
- Tolerante a formato inesperado del proveedor

### Pipeline del Agente (`src/server/ai/pipeline.ts`)

#### `scheduleAgentTurn(conversationId)`
- Punto de entrada con debounce (configurable via `AGENT_COALESCE_MS`, default 6000ms)
- Coalesce: si llega otro mensaje mientras se procesa, se reprograma

#### `runAgentTurn(conversationId)`
1. Carga conversación y verifica config de IA
2. Verifica handoff (si el agente ya transfirió a humano)
3. Verifica ventana de 24h
4. Silencio si «Activo en conversaciones nuevas» está apagado y ninguna persona
   ha respondido todavía en ESA conversación (se busca en todo el historial, no
   en la ventana de 20 mensajes que lee el prompt)
5. Backup regex de handoff ANTES del LLM (red de seguridad)
6. Construye prompt con KB + etapas + slots ofrecidos
7. Llama al LLM
8. Despacha acción
9. Si «Reaccionar con emoji» está encendido y la acción no es `none`, marca 👍 el
   mensaje del cliente (`/api/reactMessage` de WAHA). Falla en silencio: sin
   credenciales, con la ventana cerrada o con WAHA Core el turno sigue igual.

Los dos interruptores viven en Ajustes → Agente → «Respuesta automática» y se
guardan en `agent_profile`. El Laboratorio (`isTest`) los ignora: evalúa el
comportamiento configurado aunque el agente esté apagado.

### Acciones del Agente (`src/server/ai/actions.ts`)

Tipos de acción disponibles (discriminated union Zod):
- `none`: Sin acción
- `reply`: Responder al contacto
- `update_lead`: Actualizar información del lead
- `move_stage`: Mover lead a otra etapa
- `handoff`: Transferir a humano
- `offer_slots`: Ofrecer slots de cita
- `book_slot`: Reservar cita
- `send_quote`: Enviar la ficha oficial de **uno o varios** productos del catálogo: `item_id`
  o `item_ids` (hasta 5). El pipeline recorre los IDs en el orden en que el cliente los pidió
  (el `ORDER` de `inArray` no lo garantiza), deduplica, y manda **un mensaje por ficha** porque
  el tope de bytes del canal es por mensaje (`src/server/channels/capabilities.ts`): dos fichas
  juntas caben mal en Instagram. Con una sola ficha el `reply` viaja pegado a ella. Los
  productos que no están disponibles se devuelven como aviso aparte, no como ficha vacía.
- `search_inventory`: Buscar en el inventario por nombre o descripción; el servidor devuelve ID, precio y existencias reales antes de cotizar
- `create_quote`: Crear y enviar una cotización formal, de uno (`item_id`) o varios productos (`items[]`, máx. 10); idempotente por mensaje, valida disponibilidad, moneda y existencias (gate `sendProductQuotes`)

El catálogo del prompt se acota a `CATALOG_PROMPT_LIMIT` (60) productos y, si hay más, remite a `search_inventory`. El pipeline permite hasta dos búsquedas de inventario por turno antes de ejecutar la acción final.

### Handoff (`src/server/ai/handoff.ts`)

#### Regex de Backup
```typescript
const HANDOFF_REGEX = /(hablar|comunicar|contactar)...(asesor|humano|persona|alguien)|un asesor|atención humana/
```

Se evalúa ANTES del LLM como red de seguridad. Si el contacto pide hablar con un humano, el agente transfiere inmediatamente sin pasar por el LLM.

### Prompts (`src/server/ai/prompts.ts`)

#### `buildAgentSystemPrompt()`
Construye el prompt del sistema con:
- Nombre y tono del agente
- Instrucciones personalizadas
- Reglas de escalación
- Saludo personalizado
- Inyección completa de la base de conocimiento
- Etapas del pipeline
- Schema JSON de acciones

### Copiloto (IA de consulta, separada del Agente)

El CRM tiene además **Copiloto** (`/copiloto`): un asistente de **solo lectura**
para preguntarle al negocio ("¿cuánto cobramos este mes?"). No comparte
configuración con el Agente y **nunca** escribe datos ni envía mensajes. Su
configuración (fuentes de datos habilitadas) vive en Ajustes → Copiloto,
solo para el owner, y el contexto se construye acotado al tenant con datos
personales redactados. Guía completa: [docs/copiloto-agente.md](copiloto-agente.md).

### Formato de la respuesta (`src/server/ai/reply-format.ts`)

El prompt *pide* el formato; esta capa lo **garantiza** sobre lo que el modelo
devuelva, justo antes de enviar (`deliverReply`):

- Colapsa espacios y nunca deja dos líneas en blanco seguidas. Los espacios dobles
  —los que deja el modelo o el quite de marcadores— se reducen a uno para que la
  sangría de una lista quede pareja en el móvil.
- Renglones de más de 220 caracteres se parten por oraciones, no por palabras.
- Enumeraciones de tres o más elementos separados se convierten en lista.
- `*negrita*` sólo sobrevive en los canales que la renderizan (`supportsWhatsAppMarkdown`:
  WhatsApp). En Instagram y Messenger los asteriscos se quitan porque se imprimen tal cual.
- El quite de énfasis **no toca URLs ni identificadores**: `_texto_` sólo se quita
  cuando lo que rodea al guion bajo no es letra, dígito ni `/`. Sin esa guarda,
  `https://tienda.com/promo/a_b_c` y un SKU tipo `sku_12_34` salían corruptos.

#### Tope de bytes (`fitsChannel`)

`sendText` **rechaza** un texto que pasa de `maxTextBytes` del canal antes de
persistir nada: sin esta capa el cliente simplemente no recibía mensaje.
`fitsChannel` corre después de formatear, en el mismo embudo —en `deliverReply`
del agente incluido y en `POST /api/bot/messages`— y cede en este orden: primero
sacrifica el aire que añadió el formateador, luego corta por renglón y cierra con
`…`; si ni el primer renglón cabe, recorta por bytes sin partir un caracter.

#### Idioma de respuesta

`responseLanguage` se traduce a una línea dura del prompt por idioma (`es`, `en`,
`pt`, `fr`). `es` faltaba, así que "Español" elegido en Ajustes caía en la rama de
"Automático" y un cliente que escribiera en inglés recibía inglés.

### Reglas de Ajustes → Agente: dónde se cumplen

Las cinco reglas se aplican **en el servidor**, no sólo en el texto del prompt. Si el
modelo devuelve una acción desactivada, el turno la degrada
(`pipeline.ts:437-447`: `send_quote`/`create_quote`, `move_stage`, la `ficha` de
`update_lead`), y `sendProductQuotes` apagado ni siquiera ofrece `search_inventory`.
`handoffOnRequest` apagada quita el atajo por patrón y su línea del prompt, pero si el
cliente pide un humano y el modelo escala, se acata: apagar la regla no le quita al
cliente ese derecho (`pipeline.ts:729`). El `farewell` del handoff es opcional en el
esquema del modelo; cuando lo omite se manda un respaldo ("Te paso con una persona de
nuestro equipo…"), porque sin él la conversación pasaba a un humano con el cliente
mudo.

### IA por canal (`src/server/ai/channel-policy.ts`)

`agent_profile.disabled_channels` (lista negra, migración 0081) apaga al agente en un
canal entero sin tocar conversación por conversación; el interruptor de la ficha de
Bandeja sigue mandando dentro del canal. Lo consultan el turno interno y las cinco
rutas del cerebro externo (`/api/bot/context`, `/messages`, `/typing`, `/bookings`,
`/availability`). El Laboratorio (`isTest`) está exento. Un miembro que no es owner ve
el estado en modo sólo lectura desde el DTO `channelAiEnabled`.

El orden dentro del turno también importa: el guard del canal corre **antes** de
reactivar el handoff por ventana. Al revés, un canal apagado limpiaba el traspaso y la
ficha de Bandeja mostraba "atendido por el bot" cuando en realidad nadie respondía;
además, si el canal está apagado el traspaso ni se reabre (nadie lo va a atender).

### Agenda en el turno

Con `AGENDA` encendida, el prompt recibe el horario real del negocio (días, horas,
buffer, aviso mínimo, tope de días) y la orden de no forzar un hueco que el motor no
ofreció. `offer_slots` y `book_slot` delegan en `src/server/agenda/agent.ts`, y
`availability.ts` descarta los solapamientos: dos citas encima es imposible aunque el
modelo insista. Un fallo del motor degrada el turno a `reply`, nunca lo tumba.

---

## 10. Laboratorio de Auto-evaluación

### Componentes

#### Personas (`src/server/lab/personas.ts`)
- Perfiles de prueba que simulan diferentes tipos de clientes
- Cada persona tiene nombre, contexto, estilo de comunicación

#### Runner (`src/server/lab/runner.ts`)
- Ejecuta conversaciones de prueba contra el agente
- Utiliza mocks (nunca toca la API real)
- Registra resultados en `agent_test_run`

#### Juez (`src/server/lab/judge.ts`)
- Evalúa automáticamente la calidad de las respuestas del agente
- Utiliza un LLM separado (puede ser más barato: `OPENROUTER_JUDGE_MODEL`)
- Genera puntuaciones y recomendaciones

### Sandboxing (Constitución)
- Conversaciones `is_test=true` NUNCA tocan la API real
- El sender lanza excepción si se intenta (guardrail hard)
- Lo mismo aplica para la agenda: citas de prueba nunca llegan a conectores

---

## 11. Módulo de Contactos

### Esquema (`src/lib/db/schema.ts`)

```typescript
contact: {
  id: string              // ct_<nanoid>
  organizationId: string  // FK → organization
  channel: Channel        // whatsapp | instagram | messenger | tiktok
  waIdentity: string      // Identidad normalizada
  phone: string | null    // Teléfono (opcional)
  waUserId: string | null // ID de usuario WhatsApp
  name: string | null     // Nombre del contacto
  nameSource: "perfil" | "sistema"
  notes: string | null    // Notas
  ficha: json | null      // Ficha técnica (JSON)
  source: string | null   // Fuente del contacto
  archivedAt: Date | null // Fecha de archivado
}
```

### Funciones del Servidor (`src/server/contacts.ts`)

#### `serializeContact()`
Retorna: id, name, phone, notes, stageName, archivedAt, source (effectiveSource), priority, ficha.

#### `getContactById()`
Query con scope de tenant.

#### `getContactStage()`
Join con `lead` → `pipeline_stage` para info de etapa actual.

### Fuentes de Contacto (`src/server/contact-source.ts`)

`effectiveSource()` determina la fuente efectiva del contacto:
- Si tiene `source` explícito, lo retorna
- Si tiene `waIdentity` que empieza con `ig:`, `fb:`, `tt:`, retorna ese canal
- Si tiene teléfono, retorna "whatsapp"
- Default: "directo"

### Prospectos (`src/server/prospects/query.ts`, pantalla `/prospects`)

Prospección del menú: quién escribió al negocio y todavía no es cartera.

- **Es una proyección, no una tabla.** Prospecto = quien dejó un **mensaje entrante** al
  negocio y todavía no es cartera. No duplica el modelo de identidad ni exige migración; la
  etapa viene del lead que `onLeadActivity` ya da de alta al primer mensaje.
- **Dos fuentes, no una.** `listProspects()` une el chat (`message.direction = 'in'`) con el
  **correo entrante** (`listEmailProspects()` sobre `email_message.direction = 'inbound'`,
  agrupado por `from_email` con su asunto más reciente) y reordena la mezcla por
  `lastInboundAt` descendente, corte en 200. Sin la segunda rama, los 16 correos entrantes de
  10 remitentes del negocio del dueño eran invisibles: el módulo solo miraba chat y el correo
  **no** produce `contact_id` (es diseño, no un bug — ver tarea «Contactos cuenta solo la
  cartera»), así que nunca podría aparecer por la vía del contacto.
- **El DTO del remitente de correo es nullable a propósito** (`src/lib/types.ts`):
  `contactId: string | null`, `conversationId: string | null` y `email` con valor. El cliente
  elige con eso la `key`, el `seed` del avatar y el enlace: chat → `/inbox?contact=`, correo →
  `/email`. En la tarjeta, la cadena es teléfono → `mailto:` → «Sin teléfono» punteado, para
  que un correo conocido sea siempre una vía de contacto aunque no haya número.
- **Consulta** (`listProspects`): agrupa por contacto, devuelve primer/último entrante,
  cuántos mensajes, el último texto y la etapa del lead preferido. El join de
  `pipeline_stage` repite la condición de organización (Constitución III) y el límite es
  fijo (200). El texto tolerante busca con y sin acentos, por dígitos sueltos **y por correo**;
  los `%` y `_` que teclea el usuario se escapan, así que buscar "100%" no devuelve
  media base.
- **La oportunidad que se muestra** es la principal y, entre iguales, la de última
  actividad más reciente — con `nulls last` explícito (`src/lib/db/order.ts`): en
  Postgres `DESC` pone los NULL **adelante**, y `lead.last_activity_at` es nulo hasta que
  llega el primer refresco, así que un `limit(1)` sin esa cláusula elegía el lead sin
  fecha y ocultaba la etapa real. Son nueve lecturas (en ocho archivos) las que comparten
  la regla, incluidas las del cerebro externo y `leadPreferenceOrder()`.
- **Filtros** (`/api/prospects`): `q`, `channel`, `phone=falta|tiene`, `archived`.
- **Descartar es una marca, no un borrado** (`src/server/prospects/dismiss.ts`, migración
  `0083_prospect_dismissal`). Cada tarjeta tiene **Descartar**; con la casilla
  «Ver archivados y descartados» marcada, las ocultas muestran `(descartado)` y su botón
  **Restaurar**. No hay fila de prospecto que borrar —la pantalla es una agrupación de
  mensajes— y el remitente de correo ni siquiera tiene `contact_id`, así que se guarda la
  **clave** en `prospect_dismissal`: `kind = 'contact'` con el `contact.id`, o
  `kind = 'email'` con la dirección **en minúsculas** (la consulta compara contra
  `lower(from_email)` porque el `From:` llega con las mayúsculas del servidor). Contacto,
  hilos, mensajes y correos quedan intactos: descartar a alguien nunca pierde a un cliente.
  Con `archived=true` la lista **sí** recorre el correo —es el único camino para restaurar
  un remitente—, cosa que antes de esta función se saltaba.
- **Sin FK a `contact` ni a `user` a propósito**: una cascada borraría el descarte cuando se
  va el contacto o el miembro y la persona descartada **reaparecería** en la lista. La FK a
  `organization` sí va en cascada. El índice único `(organization_id, kind, key)` sostiene
  el `on conflict do nothing`: descartar dos veces no duplica ni pisa cuándo ni quién.
- **La ruta `/api/prospects/dismiss` es `withAuth`, no `withOwner`** —descartar gente es
  trabajo diario de cualquier miembro, igual que `PATCH /api/contacts/[id] {archived}`—.
  `POST` lleva el objetivo en el body y `DELETE` en la query (`?contactId=` o `?email=`),
  porque en esta API los borrados no usan body y un cuerpo en DELETE no lo garantiza el
  intermediario. Una petición ambigua (los dos campos, o ninguno, o un correo sin `@`) es
  `422` antes de escribir: una clave ambigua en esa tabla ocultaría a otro cliente.
- **Teléfono desde el chat** (`src/server/inbox/phone-capture.ts`): extrae el número que
  el cliente teclea y lo guarda en la ficha. La escritura es **append-only** — el `UPDATE`
  lleva `phone IS NULL` en el `WHERE`—, así que una reentrega de Meta o una edición del
  operador nunca pisan un número existente. Descarta fechas, precios, lo que empieza por
  0 y prefijos sueltos; prefiere el número con `+` y el más largo.
  Rechaza también la fecha **escrita como la escribe cualquiera** (`15-10-2026`,
  `15/10/2026`, `15.10.2026`): ocho dígitos con dos separadores caen justo en el rango
  que acepta la regla de separadores, y "te lo entrego el 15-10-2026" se grababa como
  teléfono del cliente. El filtro mira el candidato tal como viene en el texto, no solo
  sus dígitos, y valida los dos órdenes (DD/MM y MM/DD) para no perder un número real.
- **Marcar desde la pantalla** usa `dialHref()` (`src/lib/utils.ts`), no `tel:+…` a pelo:
  un número nacional de México son 10 dígitos y el internacional 12 (`52` + 10). Con la
  `+` delante, el móvil entendía "marca otro país" y la llamada no salía. La misma regla
  decide cómo se **pinta** el número, así que etiqueta y enlace coinciden.
- **Las fechas se normalizan en el DTO** (`isoDate()` en `prospects/query.ts`): los
  agregados `MIN/MAX(COALESCE(created_at, …))` viajan como fragmentos `sql` sin
  decodificador de columna, así que su tipo runtime depende del driver. `serializeProspect`
  acepta `Date`, string ISO o vacío y devuelve `string | null`, en lugar de llamar
  `.toISOString()` sobre lo que hubiere (fue un 500 real en producción). No se puso
  `.mapWith()` en esas proyecciones: en modo string es un no-op y en modo date intentaría
  decodificar valores que ya llegan como `Date`.
- **Un fallo de la API no se cuenta como «no hay prospectos».** `/api/prospects` que no
  responde 200 pinta el panel `LoadError` (`src/components/load-error.tsx`) con Reintentar y
  la cabecera en «— / Lista no disponible»; el estado vacío solo se muestra si la lista
  llegó y venía vacía. La misma regla —el panel sustituye al estado vacío, nunca a una
  lista ya cargada— está aplicada en Bandeja, Contactos, Cotizaciones, Proyectos, Citas,
  Pipeline, Catálogo, Proveedores, Correo, Campañas y los listados de Ajustes.
- **Superficies que capturan:** las siete que pasan por `ingestInboundMessage` (WhatsApp
  propio y Zernio, Instagram, Messenger, TikTok, correo) más el chat de Mercado Libre.
  **No capturan** los comentarios públicos ni las reseñas de Google Business: ahí un
  número suele ser ruido o el del propio negocio.

---

## 12. Pipeline Comercial y Leads

### Etapas Predeterminadas

Al crear la primera organización, se crean 5 etapas:
1. **Nuevo**: Lead recién creado
2. **En conversación**: En comunicación activa
3. **Interesado**: Muestra interés explícito
4. **Cliente**: Convertido en cliente
5. **Perdido**: No se concretó

### Leads

#### Creación Automática
Cuando un contacto envía un mensaje por primera vez, `onLeadActivity()` crea un lead automáticamente en la primera etapa del pipeline.

#### Actividad
- `lastActivityAt` se actualiza con cada mensaje
- Los eventos de cambio de etapa se registran en `lead_stage_event`

### Métricas de Funnel

El dashboard calcula:
- Tasa de conversión por etapa
- Tiempo promedio en cada etapa
- Leads creados vs. convertidos
- Pipeline value (valor total del pipeline)

---

## 13. Cotizaciones

### Estados

```typescript
type QuoteStatus = "draft" | "unsaved" | "saved" | "sent" | "viewed" 
                 | "accepted" | "rejected" | "expired" | "cancelled"
```

### Funcionalidades (`src/server/quotes/service.ts`)

#### `createQuote()`
- Advisory lock para número secuencial (`COT-XXXX`)
- Calcula: subtotal, descuento (fijo/porcentaje), IVA (default 16%), total
- `taxRate: 0` cuando el cliente pidió expresamente la cotización **sin IVA**: el agente
  manda `iva:false` en `create_quote` y el impuesto se respeta, no se reinfla al 16%
- `clientPhone` (migración 0082) es el número que se imprime en «COTIZADO PARA»; vive en
  la cotización y no sólo en la ficha porque se cotiza también a clientes sin ficha o con
  otro número. Se normaliza y limita a 32 caracteres; vacío = la línea no aparece
- Crea items y evento `created`

#### `updateQuote()`
- Solo en estado `draft`
- Reemplaza todos los items
- Row-level locking
- **Es un parche parcial de verdad**: las claves que llegan como `undefined` se filtran
  antes de mezclar con lo guardado. El handler de MCP construye el
  `Partial<QuoteInput>` completo aunque el llamador solo cambie las notas, y sin ese
  filtro `taxRate: undefined` volvía a imponer el 16 % sobre una cotización pedida «sin
  IVA» —y contacto, descuento y partidas se iban a `null`—. `null` explícito **sí** borra
  (es la única forma de vaciar notas o condiciones de pago desde esta función).

#### `listQuotes()`
Devuelve el nombre del contacto en cada fila con una segunda consulta acotada al tenant
(`inArray` sobre los ids de la página), no un join: las tarjetas del listado decían
«Sin contacto» en todas porque la fila no traía nombre. La forma del DTO la consumen
también las acciones MCP.

#### `sendQuote()`
Firma: `sendQuote(organizationId, quoteId, target)`; `target` es
`{channel: "whatsapp"|"instagram"|"messenger", conversationId?}` o
`{channel: "email", emailAccountId, emailMessageId}`.
- Bloquea la cotización (`FOR UPDATE`); sólo envía `draft`, congela versión y fija `lockedAt`
- **Chat**: usa el chat elegido en el desplegable (validado por canal y `isTest=false`) o, si no se manda ninguno, el chat del contacto. Los canales con `outboundMedia` (WhatsApp, Messenger) reciben el PDF nombrado `Cotizacion <producto> - <cliente>.pdf`; Instagram degrada a resumen en texto
- **Correo**: responde DENTRO del hilo elegido. Cuenta y mensaje ancla se resuelven con las filas propias (tenant-scoped); el destinatario lo dicta el hilo, nunca un campo del navegador; el asunto hereda `Re:` y el PDF viaja adjunto con el mismo nombre legible
- Guarda `sendChannel` (`email` incluido), inserta evento `sent` y publica webhook `quote.sent`
- El envío real ocurre dentro de la transacción (como ya pasaba con WhatsApp): si el `update` posterior fallara, el cliente recibió el archivo y la cotización queda en `draft`
- La acción MCP `quotes.send` sigue siendo de chat; el correo se manda desde el cotizador

#### `changeQuoteStatus()`
- Aceptar/rechazar
- Solo desde draft/sent/viewed

### PDF (`src/server/quotes/pdf.ts`)

Utiliza `reportPdf()` de `@/server/documents/pdf`:
- **Librería**: pdf-lib (sin dependencias de navegador)
- **Fuente**: Helvetica
- **Branding**: naranja de la marca por defecto (#E87722), configurable en Configuración → Marca
- **Formato**: Paginado con encabezado y pie
- **Columna derecha NOTAS**: un solo bloque; antes había `CONDICIONES DE PAGO` arriba y
  `NOTAS Y TÉRMINOS` repetido abajo, y el nombre no describía lo que el dueño escribe ahí
- **«COTIZADO PARA» muestra el teléfono** de `client_phone` o el de la ficha si el
  operador no lo escribió. La pantalla de detalle imprime el mismo respaldo
  (`clientPhone ?? contactPhone`) para que una cotización vieja no se vea sin número aquí
  y con número en el archivo.
- **«Sin contacto asignado»**: si la cotización no tiene contacto, el bloque no queda
  vacío — una etiqueta sola era el reporte del dueño en COT-0004. Igual que NOTAS con
  «Sin notas».
- **`wrapText()` parte lo que no cabe** (`src/server/documents/pdf.ts`): cuando una sola
  palabra es más ancha que la columna (un token kilométrico, un código de modelo, una URL)
  se rompe por ancho de caracter en vez de viajar entera y sobresalir del margen derecho.

#### Diálogo de nueva cotización (`src/components/quotes/new-quote-dialog.tsx`)

El IVA se manda `Math.max(0, Math.min(100, Math.round(Number(taxRate) || 0)))`:
`Number("")` es `0`, así que borrar el campo dejaba la cotización «sin IVA» sin querer, y
un `16.5` rebotaba contra el `z.int()` de la API con un 422 sin explicación. Notas y
condiciones de pago viajan tal cual (no `|| undefined`) para que vaciarlas las borre.

---

## 14. Cobranza y Cuentas por Cobrar

### Cuentas por Cobrar (`charge`)

```typescript
charge: {
  id: string              // ch_<nanoid>
  organizationId: string
  quoteId: string | null  // FK → quote
  contactId: string       // FK → contact
  concept: string         // Descripción
  totalAmount: number     // Monto total
  paidAmount: number      // Monto pagado
  dueDate: Date | null    // Fecha de vencimiento
  status: "pendiente" | "parcial" | "pagado"
}
```

### Pagos (`payment`)

```typescript
payment: {
  id: string
  organizationId: string
  chargeId: string        // FK → charge
  contactId: string
  fecha: Date
  monto: number
  metodo: string          // transferencia, efectivo, tarjeta, etc.
  referencia: string | null
  comprobanteUrl: string | null
  notas: string | null
  createdBy: string
}
```

### Funciones

#### `createChargeFromQuote()`
- Crea carga desde cotización aceptada
- Idempotente (verifica existencia por quoteId)

#### `createPayment()`
- Actualiza balance de la carga
- Transiciones de estado: pendiente → parcial → pagado
- Valida sobrepago

#### `getAccountsReceivable()`
- Retorna cargas con status `pendiente` o `parcial`
- Incluye `saldoPendiente` calculado

---

## 15. Balance General y Finanzas

### Servicio (`src/server/finances/service.ts`)

#### `getMonthlyBalance()`
- Mes actual: suma pagos (ingresos) y egresos

#### `getBalanceByPeriod(from, to)`
- Rango de fechas personalizado

#### `getRecentPayments()` / `getRecentExpenses()`
- Últimos 20 registros

### Reportes (`src/server/finances/report.ts`)

#### `financialReport()`
- Transacción read-only con `repeatable read`
- Retorna: balance, pagos, egresos, cargas
- Genera PDF con `reportPdf()`

### Formato de Moneda

```typescript
function money(amount: number): string
// Formato MXN: $1,234.56
```

---

## 16. Proyectos y Etapas

### Etapas Predeterminadas

1. Activacion
2. Diagnostico
3. Calendario de Entregable
4. Creacion de Entregable
5. Terminacion de Entregable
6. Reporte de Resultados
7. Renovacion

### Procesos personalizables por negocio (`project_template`)

Los pasos de un proyecto ya no vienen de un catálogo fijo del código: cada
negocio tiene sus propios **procesos** (`/project-templates`, editables por el
owner) y cada proyecto **congela** al nacer la etiqueta y la definición de sus
pasos (`project.projectTypeLabel`, `project_step.definition`).

- `src/lib/project-templates.ts` — límites (`PROJECT_TEMPLATE_LIMITS`), `slugifyProjectKey`, `uniqueProjectKey`, zod `projectTemplateInputSchema` (≥1 paso, clave reservada `general`, pasos/campos sin duplicados, listas con opciones), `DEFAULT_PROJECT_TEMPLATE_SEEDS`, `resolveStepDefinition`, `frozenStepDefinition`
- `src/server/projects/templates.ts` — `ensureProjectTemplates` siembra los 3 procesos base con `isSystem` **sólo en el negocio principal** (el más antiguo); en los demás entran como copias editables. `createProjectTemplate` valida cupo por organización y deriva la clave contra todas (incluidas las borradas lógicas). `updateProjectTemplate`/`deleteProjectTemplate` rechazan los del sistema (403) y el último proceso activo (409), promoviendo un nuevo default en la misma transacción
- `src/server/projects/steps.ts` — `ensureProjectSteps` sembró pasos desde la plantilla elegida (o el catálogo estático si no hay) y `saveProjectStep` re-congela `definition`; `listProjectSteps` resuelve cada renglón con su definición congelada, así que renombrar o borrar un proceso después no reescribe proyectos viejos
- Los "seguimientos" del proceso son sus tareas iniciales (`templateStepTasks`)
- Cualquier miembro puede crear proyectos; sólo el owner administra procesos
- Migración `drizzle/0079_project_templates.sql`

### Funcionalidades (`src/server/projects/service.ts`)

#### `createProject()`
- Advisory lock para código secuencial (`PRJ-XXXX`)
- Valida miembro asignado y contacto

#### `transitionProject()`
- Row-level locking (`FOR UPDATE`)
- Concurrencia optimista via `expectedStageId`
- Calcula `avance` como porcentaje del índice de etapa
- Completar última etapa → estado "cerrado" + avance 100%

#### `getProjectReport()`
- Agrega: proyecto, contacto, tareas, historial de etapas, estadísticas

### Tareas de Proyecto (`src/server/projects/tasks.ts`)

```typescript
project_task: {
  id: string
  projectId: string
  title: string
  description: string | null
  estado: "no_empezado" | "pendiente" | "terminado"
  priority: "alta" | "media" | "baja"
  assigneeId: string | null  // FK → member
  dueDate: Date | null
}
```

---

## 17. Tareas

### Página Global (`/tareas/`)

Muestra todas las tareas de todos los proyectos en un solo lugar.

### Funciones (`src/server/projects/tasks.ts`)

#### `listAllTasks()`
- Listado cross-project
- Join con nombre de proyecto y nombre de asignante
- Filtra por proyecto, asignante, estado

#### `updateTask()`
- Valida miembro
- Soporta actualizaciones parciales

#### `deleteTask()`
- Hard delete

---

## 18. Dashboard de KPIs

### Métricas Disponibles (60+)

#### Mensajería
- Mensajes enviados/recibidos (hoy, semana, mes)
- Tiempo promedio de respuesta
- Tasa de lectura
- Conversaciones activas
- Canales más utilizados

#### Pipeline
- Leads por etapa
- Tasa de conversión
- Tiempo promedio en pipeline
- Valor del pipeline

#### Finanzas
- Ingresos del mes
- Egresos del mes
- Balance neto
- Cuentas por cobrar pendientes
- Pagos recibidos

#### Proyectos
- Proyectos activos
- Proyectos completados
- Tareas pendientes
- Tasa de completitud

### Visualización

Utiliza **recharts** para gráficas interactivas:
- Gráficas de barras para comparativas
- Gráficas de línea para tendencias
- Gráficas de pastel para distribuciones
- Tablas detalladas

---

## 19. Sistema de Diagnóstico

### Logger (`src/server/diagnostics/logger.ts`)

#### `recordDiagnostic()`
- Inserta en tabla `diagnostic_event`
- Timeout de statement: 1500ms
- Auto-purga de eventos > 30 días (cada hora)

#### Códigos de Diagnóstico

| Código | Descripción |
|---|---|
| `api_failed` | Fallo en llamada a API externa |
| `connection_failed` | Fallo de conexión a canal |
| `connection_saved` | Conexión guardada exitosamente |
| `provider_activated` | Proveedor activado |
| `disconnected` | Desconexión de canal |
| `webhook_failed` | Fallo en webhook |
| `webhook_received` | Webhook recibido |
| `subscription_failed` | Fallo en suscripción |
| `session_changed` | Estado de sesión cambió |
| `session_action` | Acción en sesión |
| `send_failed` | Fallo al enviar mensaje |
| `media_failed` | Fallo en archivo multimedia |
| `ai_failed` | Fallo en agente IA |

### Redacción (`src/server/diagnostics/redact.ts`)

- Whitelist de claves permitidas: `httpStatus`, `operation`, `provider`, `requestId`, `durationMs`, `state`
- Valores sanitizados: números deben ser finitos, strings matchean `^[a-zA-Z0-9_.:-]{1,80}$`

### Página de Diagnóstico (`/settings/diagnostics/`)
- Solo owner (404 para no-owners)
- Muestra eventos recientes con filtros

---

## 20. Notificaciones en Tiempo Real (SSE)

### Event Bus (`src/server/events/bus.ts`)

- EventEmitter in-process con max 200 listeners
- Eventos scopeados por organización: `org:{organizationId}`
- Publicación DESPUÉS del commit en BD

### Ruta SSE (`/api/events/`)

```
GET /api/events
```

#### Headers
```http
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no  // Anti-buffering para proxies
```

#### Heartbeat
```
: ping
```
Cada ~25 segundos (Caddy no bufferiza la respuesta: `flush_interval -1` en el `Caddyfile`, §27).

#### Formato
```
event: {type}
id: {timestamp}
data: {json}

```

### Tipos de Evento

| Evento | Descripción |
|---|---|
| `message.new` | Nuevo mensaje entrante |
| `message.status` | Cambio de estado de mensaje |
| `conversation.updated` | Conversación actualizada |
| `booking.updated` | Cita actualizada |
| `lab.run` | Ejecución del Laboratorio |
| `waha.session_status` | Estado de sesión WAHA |

### Catch-up

El cliente hace refetch con `since=` parameter para recuperar eventos perdidos durante desconexiones.

---

## 21. Webhooks Salientes

### Configuración

```typescript
outbound_webhook: {
  id: string
  organizationId: string
  url: string              // URL destino
  events: string[]         // Eventos suscritos
  secret: string           // HMAC secret (cifrado)
  active: boolean
}
```

### Eventos Disponibles (22 tipos)

- `contact.*` (created, updated, deleted)
- `lead.*` (created, stage_changed)
- `conversation.*` (created, updated)
- `message.*` (created, status_changed)
- `booking.*` (created, updated, cancelled)
- `quote.*` (created, sent, accepted, rejected)
- `payment.*` (created)
- `expense.*` (created)
- `project.*` (created, stage_changed, completed)
- `email.*` (sent, received)

### Despachador (`src/server/webhooks/dispatcher.ts`)

#### Firma HMAC
- HMAC-SHA256 del payload con el secret del webhook
- Header: `X-Webhook-Signature`

#### Reintentos
- Delays: 5s, 30s, 2min
- Máximo 3 reintentos
- Auditoría en `outbound_delivery`

#### `publishWebhook()`
- Fire-and-forget dispatch a todos los webhooks coincidentes

#### `retryPendingDeliveries()`
- Cron-compatible para reintentar entregas pendientes

---

## 22. Gestión de Medios

### Tabla `media_asset`

```typescript
media_asset: {
  id: string
  organizationId: string
  messageId: string | null
  type: string             // image, video, audio, document, sticker
  mimeType: string
  fileName: string | null
  url: string | null       // URL temporal de descarga
  localPath: string | null // Ruta local persistente
  status: string           // pending, fetched, failed
  size: number | null
}
```

### Flujo

1. **Inbound**: Webhook recibe media → crea registro `status: "pending"` → descarga en background → `status: "fetched"`
2. **Outbound**: Guarda en disco local → sube a Graph API → referencia en mensaje

### Directorio

- Path configurable: `MEDIA_DIR=/data/media`
- Organización real por negocio:
  - `{MEDIA_DIR}/{organizationId}/catalog/{nanoid}.{ext}` — imágenes de catálogo (`/api/media/upload`)
  - `{MEDIA_DIR}/{organizationId}/logo-{nanoid}.{ext}` — logo (`/api/settings/business/logo`)
  - `{MEDIA_DIR}/{organizationId}/favicon` — icono del negocio (branding)
  - `{MEDIA_DIR}/{organizationId}/{assetId}` — adjuntos descargados de WhatsApp/Meta

- **Contención de rutas (`src/server/media-path.ts`)**: toda lectura o escritura
  de disco pasa por `resolveMediaFile(orgId, ...segmentos)`, que valida segmento a
  segmento (un nombre de archivo nunca empieza con punto, así que `..` es
  imposible), normaliza con `resolve` y exige que la ruta siga dentro de
  `MEDIA_DIR/{organizationId}` comparando además el `realpath` del archivo con el
  de la raíz — eso cierra también los enlaces simbólicos. Devuelve `null` para una
  ruta inválida (las rutas públicas responden 422) y la ruta para un archivo que
  no existe (404). Lo consumen las dos rutas de `/api/media/public/*`, el PDF de
  cotizaciones y `src/server/whatsapp/media.ts`.
- **Cabeceras de media (`mediaHeaders()`)**: `nosniff` en todas las respuestas y
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
  en los SVG. El logo admite SVG y lo sube un miembro del negocio; sin ese
  acotamiento, un SVG con script se ejecutaría con la sesión de quien abra la URL.

---

## 23. Branding y Personalización

### Identidad Visual (`src/lib/brand.ts`)

- **Logo**: "Z" geométrica con remate lima
- **Path del body**: `M5 6h14L5 18`
- **Path del tail (acento)**: `M5 18h14`
- **Stroke width**: 3.4
- **Colores de acento**: `#65a30d` (light bg), `#a3e635` (dark bg)

### Paleta de Colores (`src/lib/branding.ts`)

- **Nombre por defecto**: "ZORRO TECH"
- **Acento por defecto**: `#65a30d` (lima Zorro Tech)
- **Moneda**: MXN

#### 6 Presets de Acento

1. **Lima Zorro Tech** (default): `#65a30d`
2. **Dorado**: `#B8963E`
3. **Azul acero**: `#3f5972`
4. **Grafito**: `#4b5563`
5. **Verde apagado**: `#3f6b66`
6. **Ciruela**: `#5f5470`

### Variables CSS

```css
--accent: #65a30d        /* Color principal */
--accent-hover: #55890b  /* Hover state */
--accent-soft: #e3f6d3   /* Fondo suave */
--accent-tint: #f6fbf1   /* Tinte más claro */
--accent-text: #497509   /* Texto sobre fondo claro */
--accent-fg: #FFFFFF     /* Texto sobre acento */
```

### WCAG Contrast

- Light theme: mínimo 3:1
- Dark theme: mínimo 3.5:1

### Función de CSS

```typescript
accentCssVariables(): string
// Genera CSS para inyección SSR (sin flash)
```

### Almacenamiento

Se guarda en `organization.metadata` como JSON.

### Dónde se aplica (resolución por petición)

`src/server/branding.ts` expone dos lecturas distintas y usar la equivocada es
invisible hasta que hay un segundo negocio en la instancia:

| Función | Quién decide el tenant | Uso |
|---|---|---|
| `getBranding(organizationId)` | el que pasa el llamador | páginas y rutas con sesión, PDFs, pipeline |
| `getBrandingContextForRequest()` | la sesión de la petición | layout raíz, `generateMetadata`, `/api/branding/favicon`, layout de acceso |

La regla de falla-cerrada sigue igual: sin id de organización se leen hasta 2
negocios y, si hay más de uno, se devuelve `DEFAULT_BRANDING`. Por eso el layout
raíz NUNCA puede llamar a `getBranding()` a secas: con dos negocios en la
instancia toda la interfaz autenticada caería al lima neutro y el color guardado
en Ajustes → Marca no se vería jamás.

Además de las variables CSS del `<head>` (`accentCssVariables`, con los dos
temas), `BrandingClient` repite el mismo bloque en un `<style id="marca-acento">`
al guardar, para que el cambio se vea sin recargar. Sale de la misma función: no
hay dos fuentes de verdad.

---

## 24. Configuración del Sistema

### Páginas de Configuración

| Ruta | Descripción |
|---|---|
| `/settings` | Redirige a `/settings/whatsapp` |
| `/settings/whatsapp` | Wizard de WhatsApp Cloud API |
| `/settings/waha` | Configuración de WAHA |
| `/settings/instagram` | Configuración de Instagram |
| `/settings/messenger` | Configuración de Messenger |
| `/settings/tiktok` | Configuración de TikTok |
| `/settings/calendar` | Agenda/calendario |
| `/settings/ads` | Atribución de anuncios/CAPI |
| `/settings/branding` | Branding white-label + favicon |
| `/settings/team` | Gestión de equipo |
| `/settings/email` | Configuración de cuenta de email |
| `/settings/diagnostics` | Diagnósticos del sistema (solo owner) |

### Layout (`src/app/(app)/settings/layout.tsx`)

- Requiere sesión autenticada
- Pasa feature flags (agenda, attribution, channel enables) a `<SettingsNav />`
- Tabs condicionales según canales habilitados

---

## 25. Variables de Entorno

### Esenciales

```bash
# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Autenticación
BETTER_AUTH_SECRET=<random-base64-32>

# Cifrado
ENCRYPTION_KEY=<random-base64-32>

# App
APP_BASE_URL=https://crm.example.com
NODE_ENV=production
PORT=3000
```

### Meta / WhatsApp

```bash
META_WEBHOOK_VERIFY_TOKEN=<random-hex-32>
META_APP_SECRET=<optional-hmac-secret>
META_GRAPH_API_VERSION=v25.0
```

### IA (Groq, OpenAI-compatible)

```bash
OPENROUTER_BASE_URL=https://api.groq.com/openai
OPENROUTER_API_TOKEN=<api-key>
OPENROUTER_MODEL=openai/gpt-oss-120b
OPENROUTER_JUDGE_MODEL=openai/gpt-oss-20b
```

### Canales Opcionales

```bash
CHANNELS=whatsapp,instagram,messenger,tiktok
```

### Agenda y Atribución

```bash
AGENDA=true
ATRIBUCION=true
```

### Seguridad

```bash
ALLOW_SIGNUP=false
WAHA_TRUSTED_HOSTS=localhost
WEBHOOK_TRUSTED_HOSTS=
```

`META_APP_SECRET` vacío **no** es un error de configuración: desactiva la verificación de
firmas de Meta y la app lo avisa una sola vez por proceso en el log
(`[webhook] META_APP_SECRET no está configurado…`). Se aceptan los eventos por el token
de la URL para no descartar mensajes reales de clientes. Lo mismo hace Zernio con el
`webhook_secret` **por cuenta**: sin secreto guardado, la firma no se puede verificar;
con secreto, un evento sin firma se rechaza con `401`.

Las cabeceras de respuesta (§28) no son variables de entorno: están en `next.config.ts`
y viajan dentro de la imagen.

### Medios

```bash
MEDIA_DIR=/data/media
```

### Agent

```bash
AGENT_COALESCE_MS=6000
```

---

## 26. Despliegue en producción

### Infraestructura actual

- **VM**: Azure, tamaño `Standard_B2ats_v2` (1 GiB de RAM + 2 GB de swap). El tope real
  del sistema es la memoria, no el CPU: los límites por contenedor del compose suman más
  de 1 GiB, por eso `NODE_OPTIONS=--max-old-space-size=384`.
- **Sistema**: Ubuntu LTS con Docker + Docker Compose v2.
- **Directorio de despliegue**: `~/crm-lumarketing/` con `docker-compose.yml`, `.env` y
  `Caddyfile`. El `Caddyfile` va montado en solo lectura dentro del contenedor `caddy`.
- **Registro**: la imagen se construye en GitHub Actions y se publica en Docker Hub como
  `ghostbreakfast69/lumark-crm:latest`; el VPS **no compila**, hace `pull`.
- **Proxy**: Caddy (HTTPS automático con Let's Encrypt). El puerto 3000 de la app **no
  está publicado**: todo el tráfico entra por 80/443.

### Cadena de despliegue

1. `git push` a `main` → `ci.yml` corre `db:guard`, `typecheck`, `lint`, `test`, `build`
   (matriz `default` y `completo`).
2. `docker.yml` corre **independiente** de CI: valida el journal (`db:guard`), construye
   con buildx, sube `latest` a Docker Hub y entra por SSH al VPS a ejecutar
   `docker compose pull && docker compose up -d`.
3. El arranque del contenedor nuevo aplica migraciones (`node migrate.mjs`) y luego
   levanta Next (`node server.js`).

**Consecuencia operativa, y la causa de la caída de 2026-10-16**: `push` a `main` **es**
el despliegue. No hay paso intermedio ni pin por defecto, y un push directo no lo frena
la protección de rama (los *required checks* solo gatean merges de PR). Una imagen que
arranca mal —por ejemplo un `.sql` ausente en el journal— hace crash loop en el contenedor
y el público queda en 502, aunque CI estuviera en verde.

**Palanca de rollback**: `APP_IMAGE=ghostbreakfast69/lumark-crm@sha256:<digest>` en el
`.env` del servidor y `docker compose up -d app`. Por eso el compose del repo usa
`image: ${APP_IMAGE:-…:latest}` y no una imagen fija: se puede congelar una versión sin
tocar el archivo versionado.

### Pasos de despliegue (réplica nueva)

#### 1. PostgreSQL 16
- Servicio del compose con volumen nombrado `postgres_data` y tuning explícito para 1 GiB
  (`shared_buffers=96MB`, `work_mem=2MB`, `max_connections=20`).
- `DATABASE_URL` la arma el compose: `postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/lumark`.
  La contraseña vive solo en el `.env` del servidor; nunca va a el repo.
- La red interna es el nombre del servicio (`postgres`), no un host externo.

#### 2. Servicio de app
- Imagen desde Docker Hub (nada se compila en el VPS).
- Puerto 3000 interno, sin publicación hacia Internet.
- `depends_on: postgres (service_healthy)`: la app no arranca antes de que `pg_isready`
  responda.

#### 3. Variables de Entorno
El `.env` del servidor es la única fuente de secretos. **El compose es una lista nominal**:
una variable que no aparece en su bloque `environment:` no llega al proceso aunque exista
en `.env` (así fue como `INTEL` y las banderas de MCP «no hacían nada»). Mínimo:
```
DOMAIN, APP_BASE_URL, POSTGRES_PASSWORD, BETTER_AUTH_SECRET, ENCRYPTION_KEY,
META_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET, CHANNELS, MEDIA_DIR, ALLOW_SIGNUP,
OPENROUTER_API_TOKEN, INTEL/AGENDA/ATRIBUCION/GOOGLE_BUSINESS (banderas), MCP_*
```
Editar el `.env` con `>>` es un fallo conocido: si la última línea no termina en salto,
las variables se pegan (`MCP_AUDIT_RETENTION_DAYS=180MCP_DCR_ENABLED=true`). Reescribir
el archivo completo, o `printf '\n'` antes, y verificar con
`grep -c '^CLAVE=' .env`.

#### 4. Volúmenes Persistentes
- `media_data` → `/data/media` en la app (adjuntos y logos por negocio).
- `caddy_data` / `caddy_config` → certificados y estado del proxy.
- El directorio `/data` es del usuario `lumark` dentro de la imagen; si se monta un bind
  mount desde el host hay que conservar ese propietario o la escritura de media falla.

#### 5. Verificación
- Health check con la versión y el commit publicados:
  `curl -s https://DOMAIN/api/health` → `{"ok":true,"version":…,"commit":…}`. El campo
  `commit` viene de `SOURCE_COMMIT`/`GIT_SHA` quemados en la imagen, así que es la única
  prueba de qué código está corriendo.
- **Desde el propio VPS no se puede sondear el dominio** (el navegador interno habla HTTP a
  un listener HTTPS y devuelve `code=000`). La sonda local correcta es por la red docker:
  `docker compose exec caddy wget -qO- http://app:3000/api/health`.
- Cabeceras globales: `curl -I https://DOMAIN/login` debe mostrar
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security`.
- Comprobar reinicios: `docker inspect -f '{{.RestartCount}}' crm-lumarketing-app-1`.

#### 6. Copia de seguridad
- `~/scripts/backup-crm.sh` corre cada noche y deja en `~/backups` el volcado de la BD,
  los adjuntos y la configuración, con una línea `OK bd=… tablas=… media=… libres=…` en
  `backup.log`.
- Antes de un despliegue que toca esquema, dump manual `pre-deploy-<UTC>.dump.gz` y
  **copia fuera de la máquina** (`scp azureuser@…:backups/… ~/Desktop`): mientras el
  backup y el disco sean el mismo, no es un backup.

### Configuración de Webhooks WAHA

- **Importante**: Si la sesión WAHA ya existe antes del deploy, se necesita actualización manual
- Auto-registro solo ocurre en nuevas sesiones desde el CRM
- El token de la URL es `wahaWebhookToken(orgId)` (HMAC sobre el id del negocio), así que
  identifica al tenant por sí solo; el nombre de sesión **no** se usa para enrutar
  (`src/server/waha/webhook.ts:224`).

---

## 27. Docker y Contenedores

### Dockerfile (Multi-stage)

Cuatro etapas sobre `node:22-alpine`:

```dockerfile
# deps     — pnpm install --frozen-lockfile (falla si el lock y package.json discrepan;
#            sin esa bandera se publicaría una imagen con versiones no probadas)
# test     — añade chromium y corre el e2e (imagen aparte, no se publica)
# builder  — pnpm build + esbuild de scripts/migrate.mjs y scripts/seed/demo.ts a
#            bundles autocontenidos (drizzle-orm y postgres van dentro del JS, no de node_modules)
# runner   — .next/standalone + static + public + drizzle/*.sql + los dos bundles
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NODE_OPTIONS="--max-old-space-size=384"
RUN apk add --no-cache fontconfig ttf-dejavu   # sin tipografías el SVG rasterizado pierde texto
RUN mkdir -p /data/media && chown -R lumark:lumark /data
USER lumark
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
# Migrar al BOOT del contenedor nuevo y arrancar el server standalone
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
```

Puntos que se rompen si se «simplifican»:
- `--start-period=40s` cubre las migraciones del arranque; con un start-period corto
  Docker mata el contenedor mientras todavía está aplicando SQL.
- El `CMD` con `&&` es lo que convierte una migración inválida en crash loop público:
  si `migrate.mjs` aborta, Next nunca llega a escuchar. `next build` **no** ejecuta
  `migrate.mjs`, así que la build puede estar verde y el arranque roto.
- `SOURCE_COMMIT`/`GIT_SHA` como `ARG`/`ENV` es lo que `/api/health` reporta.

### Health Check

```
GET /api/health
```

Responde `200` con `{ ok, version, commit }` si el sistema está operativo.

### Caddy (proxy inverso)

`Caddyfile` en la raíz del repo, montado de lectura en `/etc/caddy/Caddyfile`:

```caddy
{$DOMAIN} {
    log                          # un acceso por petición: la evidencia de un incidente
    reverse_proxy app:3000 {
        flush_interval -1        # SSE: sin buffer, las notificaciones salen ya
        header_up X-Real-IP {http.request.remote.host}
    }
    encode gzip
}
```

- `flush_interval -1` es obligatorio para el SSE de notificaciones (§20).
- `log` + `header_up X-Real-IP`: el primero deja trazabilidad de quién llamó (scraping,
  abuso, reintentos de webhook); el segundo alimenta el rate limiting, que lee `x-real-ip`
  antes que `X-Forwarded-For` (§28). Caddy no escribe esa cabecera por defecto.
- Al cambiar este archivo en el servidor: reescribirlo **en el sitio** (`cat nuevo > Caddyfile`),
  nunca `mv`. El bind mount sigue el *inode*; un `mv` deja el contenedor leyendo el archivo
  viejo aunque el disco muestre el nuevo. Después, `caddy reload` dentro del contenedor en
  lugar de recrearlo (recrear interrumpe las conexiones SSE).
- Validar antes de aplicar: `docker run --rm -v $PWD/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`.

### Contenedores en el VPS

| Contenedor | Descripción |
|---|---|
| `crm-lumarketing-app-1` | Aplicación CRM (imagen de Docker Hub) |
| `crm-lumarketing-postgres-1` | PostgreSQL 16 |
| `crm-lumarketing-caddy-1` | Caddy, proxy inverso con TLS (puertos 80/443) |
| `portainer` | Gestión de contenedores (fuera del compose del repo) |

Los tres servicios del compose llevan tope de logs `json-file` (`10m` × 3 archivos) salvo
`postgres`, que no lo tiene porque cambiarlo requiere reiniciar la BD. Sin tope, los logs
llenan el disco y el síntoma no es «logs viejos»: es Postgres o Caddy sin donde escribir.

---

## 28. Seguridad

### Cifrado en Reposo

#### AES-256-GCM (`src/lib/crypto/index.ts`)

```typescript
encryptSecret(plaintext: string): EncryptedValue
// { cipher: base64, iv: base64, tag: base64 }

decryptSecret(encrypted: EncryptedValue): string
// Retorna texto plano
```

### Datos Cifrados

- Token de WhatsApp (Meta Cloud API)
- API key de WAHA
- Token de Instagram
- Token de Messenger
- Token de TikTok
- Token de IA (agent_profile)
- Secrets de webhooks salientes
- Llaves HMAC de integración

### Autenticación de Webhooks

#### Meta Cloud API
1. **Token de URL**: Segmento secreto en la URL del webhook
2. **Firma HMAC**: `X-Hub-Signature-256` header (opcional pero recomendado)

La capa 2 se evalúa solo si `META_APP_SECRET` está configurado. Sin ese valor, el webhook
**acepta** la entrega por el token de la URL y deja un aviso único en el log del proceso
(`[webhook] META_APP_SECRET no está configurado…`). Es una elección deliberada: rechazar
descartaría mensajes reales de clientes. Para instancias con clientes activos, configurar
el secreto es la acción correcta, no cambiar el código.

#### WAHA
- Token HMAC-SHA256 por organización
- Generado: `wahaWebhookToken(orgId)` = HMAC de `waha:{orgId}`

#### Zernio
- Firma HMAC-SHA256 del body
- Headers: `x-zernio-signature` (primario), `x-late-signature` (legacy)
- Con `webhook_secret` en la cuenta la firma es obligatoria; omitir la cabecera
  rechaza el evento (`src/server/zernio/index.ts:49`)

### Cabeceras de respuesta (`next.config.ts` → `headers()`)

Se declaran en la configuración de Next, no en un middleware ni en el proxy, para
que viajen con la imagen y sean reproducibles desde el repositorio:

| Cabecera | Valor | Por qué |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | El navegador no reinterpretará un archivo subido como otra cosa |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking; la única vista embebida es el `<iframe>` propio de PDF sobre un `blob:` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | No se filtra la ruta completa a terceros |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | La app no usa estos permisos: el audio se sube como archivo y la ubicación llega de WhatsApp, no del navegador |
| `Strict-Transport-Security` | `max-age=15552000` | 180 días, sin `preload` ni `includeSubDomains` para dejar salida |

**Sin CSP global a propósito**: Tailwind inyecta estilos en línea y una CSP mal
calibrada rompe la UI en producción. El único contenido que un tercero controla
(el SVG del logo) lleva su propio CSP con `sandbox` en la respuesta de media.

### Rate Limiting

- Login/Register: 10 intentos por 10 minutos por IP (`AUTH_RATE_LIMIT`).
- Alta de negocio (`/api/auth/organization`): 10 por 10 minutos **por id de
  usuario**, con bucket distribuido en PostgreSQL (`checkDistributedRateLimit`),
  así sobrevive a varias réplicas sin Redis.
- Webhooks: `WEBHOOK_RATE_LIMIT` (120/min).
- La IP se toma de `x-real-ip` y, si falta, del **último** hop de
  `X-Forwarded-For`: el primer hop lo escribe el cliente. Caddy rellena XFF con
  la IP real del socket (el Caddyfile no declara `trusted_proxies`) y ahora además
  escribe `X-Real-IP`; el puerto 3000 no está publicado, así que ninguno de los
  dos se puede falsificar desde fuera.
- Si la tabla de buckets falla, `checkDistributedRateLimit` **no** bloquea
  (fail-open) para no descartar webhooks legítimos; queda en el log.
- Las rutas internas autenticadas (lista de Prospectos, Citas, paneles de
  Inteligencia) no llevan limitador propio: lo que sí quema presupuesto de un
  tercero está acotado más abajo, en la fuente. SerpApi reserva cuota mensual por
  organización antes de llamar (`reserveSerpApiUsage`), y Google Trends cachea y
  serializa sus peticiones (`rateLimitedFetch` en
  `src/server/intel/sources/google-trends.ts`).

### Validación de URLs WAHA (`src/server/waha/url.ts`)

```typescript
privateAddress(ip: string): boolean
// Detecta IPs privadas/loopback (RFC 1918, link-local, multicast)

validateWahaUrl(url: string): void
// Requiere HTTPS para hosts públicos
// Bloquea IPs privadas salvo que estén en WAHA_TRUSTED_HOSTS
```

### Saneamiento de lo que llega de fuera

Cuatro piezas de código existen solo porque hay valores cuyo contenido decide un
tercero —el que manda el mensaje, el que arma el CSV de precios, el autor de un
comentario— y ese valor termina en un `href`, en una cabecera HTTP o en una celda
que Excel evalúa.

| Pieza | Qué guarda | Regla |
|---|---|---|
| `assetViewHeaders()` / `assetContentType()` en `src/server/media-path.ts` | el `content-type` con el que se sirve un adjunto privado | el MIME guardado viene del payload del webhook o del `content-type` remoto; solo se muestran `image/*` (menos SVG), `video/*`, `audio/*` y PDF. Lo demás se aplana a `application/octet-stream` con `attachment`, siempre con `nosniff` |
| `safeHttpUrl()` / `webHref()` / `mailtoHref()` en `src/lib/safe-url.ts` | cualquier enlace que acaba en un `<a>` | canonicaliza con `new URL` y compara `parsed.protocol` contra `http:`/`https:`. No basta con mirar el prefijo crudo: `new URL` **elimina tabuladores y saltos de línea**, así que `java\nscript:` se normaliza a `javascript:`. Tope de 1024 caracteres. Un enlace inválido no borra el registro: se queda sin enlace |
| `escapeCsvCell()` en `src/lib/csv.ts` | los export `.csv`, tanto del servidor como del navegador | prefija `'` a lo que empieza por `=`, `+`, `-` o `@` (o por un espacio/tabulador previo más uno de esos), porque Excel y Sheets lo **evalúan** al abrir. Los números negativos puros se dejan intactos para no romper las sumas |
| `likeContains()` en `src/lib/db/like.ts` | los `LIKE`/`ILIKE` con texto escrito por el usuario | escapa `\`, `%` y `_`. Sin esto, buscar «100%» o un `%` suelto deja de ser una búsqueda y se convierte en un comodín que barre la tabla |

Y una regla que no es de seguridad pero se portó como tal: los enteros de
paginación se leen con `intParam()` (`src/lib/api.ts`). Varios listados hacían
`parseInt(...)` sin respaldo, y un `?limit=abc` o `?limit=-1` llegaba hasta
Postgres, que rechazaba el `LIMIT` y respondía 500 — que las pantallas leían como
«no hay datos».

### Torre de control: quién puede abrir un negocio

1. El registro público está cerrado (`ALLOW_SIGNUP=false`, gate FR-060 en
   `/sign-up/email`).
2. El alta legítima es la tarjeta «Negocios de la instancia» de
   Ajustes → Equipo, reservada al dueño de la instancia (`isInstanceOwner()`), y
   escribe la organización **sembrada** (embudo, canales, perfil de agente).
3. El endpoint `POST /api/auth/organization/create` del plugin de Better Auth
   queda cerrado a quien no sea dueño de la instancia con
   `allowUserToCreateOrganization` (`src/lib/auth/index.ts:110`). Sin eso, un
   miembro abría un tenant sin sembrar por su cuenta.
4. `/api/auth/organization` (el de la app) solo crea si el usuario no pertenece ya
   a ningún negocio, y ahora además está limitado por tasa.

### Tower of Hanoi de Seguridad

1. **Capa 1**: Autenticación de usuario (Better Auth)
2. **Capa 2**: Multi-tenancy (scoped queries)
3. **Capa 3**: Cifrado en reposo (AES-256-GCM)
4. **Capa 4**: Rate limiting
5. **Capa 5**: Validación de inputs (Zod)
6. **Capa 6**: Webhook verification (HMAC)

---

## 29. Constitución y Reglas

### Regla I: Seguridad
- Secretos cifrados en reposo (AES-256-GCM)
- Jamás al cliente ni a logs
- Token de WhatsApp solo muestra últimos 4 caracteres

### Regla II: Soberanía
- El NÚCLEO depende solo de WhatsApp Cloud API + proveedor LLM OpenRouter-compatible opcional
- Prohibido meter S3/R2, email, billing u otros terceros en el core
- Servicios de terceros solo entran como **conectores opcionales**:
  - Apagados por defecto tras bandera (patrón ADR-001)
  - Aislados tras adaptador con contrato público
  - Camino sin dependencia externa y degradación definida
  - Credenciales del negocio cifradas
  - CI que lo prueba apagado y encendido
- Auth y BD self-hosted

### Regla III: Multi-tenancy
- `organization_id` NOT NULL en toda tabla de dominio
- Toda query pasa por `scoped()` de `src/lib/db/tenant.ts`

### Regla IV: Idempotencia
- Webhooks dedup por `wa_message_id` UNIQUE
- Estados monotónicos
- Seeds y migraciones re-ejecutables

### Sandbox del Laboratorio
- Conversaciones `is_test` JAMÁS tocan la API real
- El sender lanza excepción (no lo "arregles": es un guardrail)
- Lo mismo vale para la agenda: una cita de prueba nunca llega a un conector

### Módulos Opcionales (ADR-001)
- Lo que no usa toda instancia va detrás de una bandera de despliegue
- Apagado por defecto, con su superficie en 404
- Migración aplicada igual (tablas vacías son inertes)
- Nunca en una rama aparte

---

## 30. Guía de Configuración por Canal

### WhatsApp (Meta Cloud API)

1. Crear app en Meta Developer Portal
2. Configurar WhatsApp product
3. Obtener Phone Number ID y WABA ID
4. Configurar webhook URL en Meta: `https://crm-domain/api/webhooks/wa/{token}`
5. Configurar `META_WEBHOOK_VERIFY_TOKEN`
6. Ingresar credenciales en Settings → WhatsApp

### WhatsApp (WAHA)

1. Desplegar WAHA (Docker)
2. Configurar URL del servidor en Settings → WAHA
3. Ingresar API key
4. Escanear QR desde el teléfono
5. Verificar estado "WORKING"
6. Webhook se configura automáticamente

### Instagram (Zernio)

1. Crear cuenta en Zernio
2. Vincular cuenta de Instagram
3. Configurar webhook URL: `https://crm-domain/api/webhooks/ig/{token}`
4. Ingresar credenciales en Settings → Instagram
5. Seleccionar source: "zernio"

### Messenger (Meta/Zernio)

1. Crear página de Facebook
2. Opción A (Meta directo): Configurar webhook en Meta
3. Opción B (Zernio): Vincular en Zernio
4. Configurar webhook URL: `https://crm-domain/api/webhooks/messenger/{token}`
5. Ingresar credenciales en Settings → Messenger

### TikTok (Zernio)

1. Crear cuenta en Zernio
2. Vincular cuenta de TikTok
3. Configurar webhook URL: `https://crm-domain/api/webhooks/ig/{token}` (misma que Instagram)
4. Ingresar credenciales en Settings → TikTok
5. Agregar `tiktok` a variable `CHANNELS`

**Nota**: TikTok DMs solo funcionan como reply (no cold outreach), con límite de 1000 bytes por mensaje y máximo 3MB por imagen.

---

## 31. Troubleshooting

### El CRM no carga

1. Verificar health check: `curl https://crm-domain/api/health`
2. Verificar logs del contenedor: `docker compose logs --tail=200 app` (en el VPS, desde
   `~/crm-lumarketing`)
3. Verificar Postgres: `docker compose ps` y `docker compose logs --tail=50 postgres`
4. Verificar que las migraciones se aplicaron (logs de arranque + `drizzle/meta/_journal.json`)
5. Verificar reinicios: `docker inspect -f '{{.RestartCount}}' crm-lumarketing-app-1` —
   un número alto con `health=starting` es una migración que aborta el `CMD` (§27)

### Webhooks no llegan

1. Verificar URL del webhook en la plataforma externa
2. Verificar token en la URL
3. Verificar firma HMAC si está configurada
4. Verificar logs de diagnóstico en Settings → Diagnostics
5. Verificar los logs del contenedor (`docker compose logs app`) y el access log
   de Caddy: con el `log` del bloque `reverse_proxy` queda registrado el POST
   entrante, así que se distingue «no llegó» de «llegó y lo rechacé»

**Qué significa cada código de rechazo**

Las rutas de Meta e Instagram/Messenger/TikTok responden el rechazo **al emisor**:

| Código | Causa | Comprobación |
|---|---|---|
| `404` | El segmento `{token}` de la URL no es `META_WEBHOOK_VERIFY_TOKEN` | Regenerar la URL desde el CRM |
| `401` | Firma ausente o inválida | Meta: `x-hub-signature-256` contra `META_APP_SECRET`. Zernio: `x-zernio-signature` / `x-late-signature` contra el `webhook_secret` **de esa cuenta** |
| `403` (solo el GET de challenge) | El `hub.verify_token` del challenge no coincide | Copiar el token tal cual desde la configuración de la instancia |
| `429` | Bucket de rate limiting lleno (`WEBHOOK_RATE_LIMIT`, 120/min) | Ver si la plataforma está reintentando en ráfaga |

**WAHA es distinto**: la ruta acusa recibo con `200` **antes** de procesar (en `after()`)
para que WAHA no reintente. Por eso los códigos de `handleWahaWebhook` — `404` cuando el
token no es el HMAC (`wahaWebhookToken(orgId)`) de ningún negocio, `500` si el
procesamiento falla — **no los ve WAHA**: solo pueden salir por log. Un token
desactualizado descarta mensajes sin dejar rastro visible; ante dudas, comparar el token
de la URL de WAHA con el que muestra Settings → WAHA antes de buscar otra causa.

**La firma de Meta se está ignorando**: si `META_APP_SECRET` está vacío, la Capa 2
queda desactivada y los eventos se aceptan solo por el token de la URL. Se avisa
**una vez por proceso** en los logs del contenedor:
`[webhook] META_APP_SECRET no está configurado: las firmas de Meta se aceptan sin verificar.`
Ese aviso no es un fallo de ingesta —es una degradación deliberada para no descartar
mensajes reales de clientes. Poner el secreto cierra la capa sin código.

**WAHA con dos negocios**: el negocio se resuelve **por el token de la URL**
(`src/server/waha/webhook.ts:224`), no por `session`, porque el nombre de sesión no es
único entre tenants. Un log `[waha] La sesión «…» no está en las credenciales del
negocio; el evento se enruta por token` indica una sesión desconocida, pero el evento
**sí** se procesa. Si la respuesta es `404`, el token no pertenece a ninguna fila de
`waha_credentials`.

**Zernio devuelve `401`**: con `webhook_secret` guardado en la cuenta, un evento sin
cabecera de firma se rechaza (antes se aceptaba: era el agujero A-03). Si Instagram,
Messenger o TikTok dejaron de ingestar tras ese arreglo, comparar el secreto del CRM
con el que Zernio usa para firmar. Una cuenta **sin** secreto sigue con la capa
desactivada, como antes.

### Un miembro recibe 403 al intentar crear un negocio

No es un bug: `allowUserToCreateOrganization` (`src/lib/auth/index.ts:110`) solo deja
crear organizaciones al **dueño de la instancia** (propietario de la organización más
antigua). El plugin responde `403` con
`YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION`. El alta legítima de un cliente es
Ajustes → Equipo → «Negocios de la instancia» (`/api/settings/clients`), que crea cuenta
y negocio y siembra embudo, canales y perfil de agente; la auto-alta de quien acaba de
registrarse es `/api/auth/organization` (usado por `/register` y `/crear-negocio`).

Detalle de por qué esto es un cierre real y no cosmético: el plugin tiene un bypass
interno (`isSystemAction`: body con `userId` y sin sesión) para el server-to-server, pero
en una petición HTTP `getSessionFromCtx()` sin sesión lanza `UNAUTHORIZED` **antes** de
evaluarlo, así que ese bypass no es alcanzable desde el navegador.

### `429` al dar de alta un negocio

`POST /api/auth/organization` comparte la ventana de `AUTH_RATE_LIMIT` (10 intentos /
10 min) con un bucket propio por usuario (`org-provision:<userId>`). Tras varios
reintentos fallidos hay que esperar la ventana; el bucket vive en la tabla
`rate_limit_bucket`, así que se puede vaciar con un `DELETE` si hace falta desbloquear
a un cliente.

### `pnpm seed:demo` se niega a escribir

Con más de un negocio en la instancia el seed exige `--org=<id>` y aborta con «Hay N
negocios; indica cuál con --org=<id>». Antes elegía la primera organización del
`select`, que en multi-tenant no es un orden estable: sembraba datos de prueba en el
tenant equivocado.

### Una imagen pública devuelve `422`

`422` en `/api/media/public/*` es el guard de contención de rutas
(`src/server/media-path.ts`): algún segmento no cumple la regla de nombre de archivo
(un segmento nunca empieza con punto, así que `..`, `....` o `%2e%2e%2f` se descartan
antes de tocar disco). Un `404` con ruta válida significa que el archivo no existe. No
es un fallo de permisos ni de `MEDIA_DIR`.

### IA no responde

1. Verificar `OPENROUTER_API_TOKEN` en Settings → Agent
2. Verificar que el modelo está configurado correctamente
3. Verificar logs de diagnóstico
4. Verificar que `resolveAiConfig()` retorna token válido

### Mensajes no se envían

1. Verificar estado de la sesión (WhatsApp/WAHA)
2. Verificar ventana de 24h
3. Verificar credenciales del canal
4. Verificar logs de `send_failed` en diagnóstico

### Errores de Build

1. Verificar los logs del job `docker.yml` en GitHub Actions (build, push, deploy)
2. Verificar errores de TypeScript: `pnpm typecheck`
3. Verificar errores de lint: `pnpm lint`
4. Verificar el guard de migraciones: `pnpm db:guard`
5. Commit fix y push para rebuild automático — recuerda que el push **es** el despliegue (§26)

### BD no conecta

1. Verificar `DATABASE_URL` en variables de entorno (la arma el compose desde
   `POSTGRES_PASSWORD`, no se escribe a mano)
2. Verificar que PostgreSQL está corriendo y sano: `docker compose ps postgres`
3. Verificar que el host es el interno de la red docker (`postgres`), no un host externo
   ni `localhost`: dentro del contenedor `app`, `localhost` es el propio `app`
4. Si el arranque falla con `P1000`/`password authentication failed`, el `.env` del
   servidor cambió pero el volumen `postgres_data` conserva la contraseña original; no se
   «arregla» editando la BD, se alinea el `.env` con la instancia existente
5. Probar la conexión desde la app: `docker compose exec app wget -qO- http://127.0.0.1:3000/api/health`

---

## 32. Glosario

| Término | Definición |
|---|---|
| **ADR** | Architecture Decision Record |
| **AES-256-GCM** | Algoritmo de cifrado simétrico |
| **Better Auth** | Librería de autenticación para Next.js |
| **BSUID** | Business-Scoped User ID (Meta) |
| **CAPI** | Conversions API (Meta) |
| **Channel** | Canal de comunicación (whatsapp, instagram, messenger, tiktok) |
| **CRM** | Customer Relationship Management |
| **Drizzle ORM** | ORM para TypeScript/PostgreSQL |
| **Caddy** | Proxy inverso con TLS automático en producción |
| **HMAC** | Hash-based Message Authentication Code |
| **IVA** | Impuesto al Valor Agregado (México) |
| **KPI** | Key Performance Indicator |
| **Lab** | Laboratorio de auto-evaluación del agente |
| **Lead** | Cliente potencial en el pipeline |
| **MXN** | Peso mexicano |
| **OpenRouter** | Proveedor de acceso a modelos LLM |
| **Pipeline** | Flujo comercial de etapas |
| **SSE** | Server-Sent Events |
| **SSRF** | Server-Side Request Forgery |
| **WAHA** | WhatsApp HTTP API |
| **WABA** | WhatsApp Business Account |
| **Zernio** | API unificada para múltiples plataformas |

---

## 33. Inteligencia de mercado (`/inteligencia`)

Módulo opt-in de investigación: qué se busca en el país, dónde, en qué formato y
contra quién. No toca el pipeline ni envía nada: solo lee, guarda y muestra.

### Existencia: la bandera `INTEL`

- Mismo criterio que `AGENDA` y `GOOGLE_BUSINESS` (ADR-001): **el código viaja siempre en
  `main`** y lo que decide si EXISTE para el usuario es una variable de despliegue
  (`src/server/intel/flag.ts`). Sin bandera, `/inteligencia` responde `notFound()` y las
  doce rutas de `/api/intel/*` devuelven **404, no 403**: si el módulo no está encendido,
  ese endpoint no existe en esta instancia, y tampoco se le piden credenciales a nadie.
- `parseIntelFlag()` acepta `on`, `1`, `true`, `si`, `sí`, `yes` (recortado y a minúsculas);
  cualquier otro valor, apagado. Se lee de `process.env` directo, igual que `agendaEnabled()`.
- La migración de las once tablas se aplica **siempre**: tablas vacías son inertes, y a
  cambio todas las instancias comparten la misma estructura.

### Superficie

- **Entrada**: un solo renglón del menú (`{ href: "/inteligencia", label: "Inteligencia" }`
  en `src/config/nav.ts:61`) y **sin pestañas** dentro de la pantalla: los paneles se apilan
  en una sola columna que se filtra con una búsqueda común. La página es visible para todos
  los roles (`src/app/(app)/inteligencia/page.tsx`).
- **Rutas** (`src/app/api/intel/`, doce): `trends` (serie de los términos monitoreados),
  `gt?termId=` (reporte de un nicho), `gt/ingest`, `ingest` (lanza el job `gt_all`),
  `geo?termId=` y su POST (credenciales + ingesta DENUE), `trending` (GET con `geo`,
  `hours`, `category`, `type`, `q`, `sort`; POST lanza el job con `hours` y `geo` que
  por defecto es `MX`), `content?days=&q=` (videos), `keyword?q=` (intención + dificultad),
  `compare?ids=`, `monitor` (alta/edición de términos), `suggest?q=` y `jobs/[id]`.
- **Toda ruta** hace lo mismo en las dos primeras líneas: `if (!intelEnabled()) return
  intelDisabledResponse();` y luego scopea por `session.organizationId` (Constitución III
  — en `monitor` con `scoped(schema.intelTerm.organizationId, …)` explícito porque el filtro
  no cae del lado de la proyección).

### Fuentes y cadena de respaldo

Cinco proveedores, guardados y probados **de forma independiente** (`SourceKey` en
`src/server/intel/credentials.ts`: `youtube`, `denue`, `serpapi`, `apify`, `gt`); no se exige
YouTube para configurar SerpApi. Los secretos van cifrados AES-256-GCM (triple
`cipher/iv/tag`), cada fuente tiene estado de última prueba en vivo (`ok`/`error` + fecha,
para el badge de la UI) y contador de uso (SerpApi y Apify reservan antes de llamar).

Google Trends se resuelve en cadena (`src/server/intel/trends-orchestrator.ts`):

1. **SerpApi** — principal, acceso estructurado; cada `data_type` es una consulta aparte
   (`TIMESERIES`, `GEO_MAP_0`, …).
2. **Apify** — respaldo con un Actor configurable desde el panel; el adaptador normaliza la
   salida al mismo formato que SerpApi.
3. **Conector web** (`sources/google-trends.ts`) — endpoints no oficiales de
   `trends.google.com/trends/api/*` (los mismos que pytrends). **UNPROBADO y puede cambiar
   cuando Google lo decida**: por eso es el último eslabón.
4. `null` — sin datos. La UI lo dice; nunca inventa una serie.

- Cada respuesta **declara su `provider`** y la interfaz lo etiqueta (`sourceLabel`).
- **No se consultan dos proveedores para la misma petición** — desperdiciaría créditos. El
  fallback solo se activa ante errores reales del principal, no ante una keyword inválida.
- Otras dos fuentes, independientes de esa cadena: **`suggest`** (autocompletado público,
  sin API key, degradación obligatoria si falla, cacheado por sesión en memoria) y
  **`trending-now`** (qué se está buscando *ahora* en el país, con volumen y hora de inicio
  — otra superficie distinta del explorador de nichos).
- **YouTube Data API v3** lee los videos más populares de la región (MX) y los contrae
  contra los términos monitoreados. `part=statistics` cuesta 1 unidad de cuota por llamada;
  con `maxResults=50` la ingesta diaria ronda **1 unidad de las 10 000 gratuitas**.
- **DENUE (INEGI)** es el respaldo geográfico: directorio público de unidades económicas,
  token gratis por email. Da el desglose por estado cuando Google Trends no lo aporta.

### Datos y trabajos asíncronos

- **Once tablas** `intel_*` en `src/lib/db/schema.ts`: `intel_credentials`, `intel_term`,
  `intel_snapshot`, `intel_video`, `intel_search_log`, `intel_geo_snapshot`,
  `intel_gt_snapshot`, `intel_gt_region`, `intel_gt_related`, `intel_gt_trending`,
  `intel_job`.
- **El catálogo de términos se siembra solo** en el primer uso de la organización con
  **16 nichos** de tecnología en México (los giros de Zorro Tech + retail tech,
  `SEED_TERMS` en `src/server/intel/terms.ts`), editable después. El cruce de videos es por
  **keyword**, no por nombre exacto.
- **Las ingestas pesadas no corren dentro de la petición HTTP** (15+ nichos con ~60 llamadas
  externas, 32 estados DENUE): podían rebasar timeouts y duplicarse entre clics. `jobs.ts`
  las convierte en trabajos: el POST crea el job `running` y responde **202 con su id**; el
  índice único parcial `intel_job_active_uq` impide dos jobs activos por (org, kind, término)
  — el segundo clic recibe `null` y **409**; la UI sondea `GET /api/intel/jobs/[id]` y muestra
  avance real; un job que quedó `running` tras un reinicio del proceso se libera solo
  (se marca `error`) antes de crear el siguiente. `IntelJobKind` es `gt_all`, `gt_term`,
  `geo`, `trending`.

### La regla de anclaje de la búsqueda

**Una búsqueda tiene que relacionar todas las fuentes con el texto escrito, no taparlas.**
`src/server/intel/content.ts:137` tipifica `query: string | null` y decide los dos caminos:
sin texto se muestra el feed popular completo; con texto **se filtra** y **se declara cuántos
videos casaron**. La alternativa (ocultar el explorador bajo una búsqueda) se implementó, se
desplegó y se revirtió dentro del mismo lote: dejó la pantalla con un solo panel y la sensación
de que «la Inteligencia ya no tiene datos». Es la misma familia que el hallazgo de
«un fallo de la API no es un listado vacío» de Prospectos (§11): la interfaz debe decir *qué*
le falta, no fingir que no hay nada.

**Qué significa «relacionar» (lote del 22-10-2026).** Tres reportes del dueño con las mismas
capturas —el mapa DENUE de un nicho ajeno con todos los estados en `≥10`, la franja verde
«Enfócate en: Smartphones, Accesorios de celular» y el «Interés comparado» mezclando la consulta
con esos nichos— dejaron claro el caso que faltaba: una búsqueda **sin ninguna palabra en común**
con el catálogo. Antes, `rankTerms` (`src/server/intel/terms.ts`) descartaba los términos con
score 0, así que no había etiqueta que declarara la distancia y los paneles del catálogo se leían
como si fueran el resultado de la consulta. Ahora:

- `analyzeKeyword` devuelve **todo** el catálogo en `catalogMatches` (sin el tope de 6), con
  `score` 0 cuando no comparte palabras y `via: ""`. El parecido se mide **por palabras** del
  nombre o las keywords, no por tema de negocio: la interfaz lo dice con esa precisión y usa
  «sin palabras en común», nunca «sin relación».
- `src/lib/intel-relation.ts` (sin importar `@/lib/db`, para que no arrastre la base al bundle)
  ordena y etiqueta lo ya medido: `es tu búsqueda`, `N% parecido`, `sin palabras en común`.
- **Ningún panel se oculta bajo una búsqueda.** El orden cambia (exacto → palabras compartidas →
  ninguna), el contenido no. El preámbulo «Contexto de tu búsqueda» declara el caso —nicho exacto,
  vecino con su porcentaje, o catálogo sin palabras en común— y ofrece **«Monitorear «q»»**, una
  acción del dueño que crea el nicho y dispara una ingesta GT; nada se escribe solo.
- **Ranking (`GtRanking`)**: la franja verde «Enfócate en» solo puede recomendar nichos que
  **sean** la búsqueda. Si no hay ninguno, muestra un bloque neutro con el más cercano (o «ninguno
  comparte palabras») y aclara que el resto del ranking es referencia. Cada fila lleva su chip.
- **Comparativa**: la leyenda de cada serie repite su etiqueta de relación; la línea gruesa sigue
  siendo la consulta en vivo.
- **Subregiones, temas y consultas GT**: reciben `note` con la relación del nicho que se está
  viendo (`activeRelationNote`), porque el selector permite cambiar de nicho sin perder de vista
  qué es y qué no es la búsqueda.
- **Mapa DENUE (`GeoPanel`)**: cada `<option>` del selector declara su relación y la nota bajo el
  título explica siempre de quién es el mapa. El desglose por estado solo existe para nichos
  monitoreados (32 consultas), pero el panel sí habla de la consulta con el **conteo nacional ya
  pagado** (`overview.competition`, una sola llamada del análisis) y dice cómo obtener su mapa.
  Si los 32 estados salen censurados (`≥10`), se advierte que es un límite de DENUE y no un
  empate de competencia.
- **Tendencias actuales**: el filtro por la consulta es por palabra (`mentionsQuery`), declara
  **cuántas de cuántas** casaron y, si son cero, cae a la cadena de respaldo de la subsección
  siguiente (mismo giro → catálogo → país), siempre etiquetada.
- **Fuera de alcance, a propósito**: `CompareView` compara nichos que el dueño eligió a mano (no
  es un resultado de la búsqueda); un mapa DENUE por estado para una consulta no monitoreada
  costaría 32 llamadas y YouTube en vivo por consulta 100 unidades de cuota. Se prefiere el
  conteo nacional y el enlace a «Monitorear» antes que gastar cuota sin autorización.

### La regla «nunca vacío» y su cadena de respaldo

**Si la consulta no tiene datos, el panel no queda vacío: baja de nivel y lo declara.** Instrucción
del dueño (22-10-2026): «aquí jamás dejen vacíos; si sobre el nicho no hay info entonces muestra
las tendencias del mismo giro con mayor alcance». Se implementa con datos que ya están en pantalla
o en la base — sin llamadas nuevas a proveedores ni cuota adicional.

- `src/lib/intel-fallback.ts` (puro y client-safe) define la cadena de «Tendencias actuales»:
  `consulta` (el filtro por palabra de siempre) → `mismo-giro` (filas cuyo título menciona el
  nombre o las keywords del nicho principal y de los nichos que comparten palabra con él, p. ej.
  «Cámaras IP» ↔ «Cámaras de seguridad») → `catalogo` (cualquier nicho monitoreado) → `pais`
  (las filas de mayor volumen, declaradas como sin relación con el catálogo). Los niveles de
  respaldo se ordenan por **volumen** —«mayor alcance»—; las coincidencias conservan el orden que
  eligió el dueño en el panel. Cada fila de respaldo lleva chip de nicho y la palabra que la
  delata (`«alarma» → Alarmas y sensores`); el CSV añade la columna `relacion`.
- `catalogMatches` ahora viaja con `keywords` (misma lectura del catálogo en `analyzeKeyword`,
  coste cero): sin ellas el cliente no podría atribuir una tendencia a un giro. En
  `CatalogMatch` (`src/lib/intel-relation.ts`) `keywords` es opcional para no romper respuestas
  antiguas en caché.
- «Contenido que funciona»: si la consulta no aparece en ningún video, `getContentInsights`
  devuelve la **muestra completa** con `fallback: "sample"` y `matchedVideos: 0` (nunca finge
  coincidencias); el panel la pinta con un aviso que la declara como referencia de formato,
  duración y patrones del giro. Si no hay **ningún** video capturado (falta la API key), el panel
  pinta las señales de Google Trends ya cargadas por la búsqueda (nicho exacto y
  `overview.market`), con su fuente, en vez de dejar solo instrucciones. `buildContentSignals`
  deduplica etiquetas y pone las alzas primero.
- **Lo que no hace**: no inventa parentesco (sin palabras en común no hay «mismo giro»; el nivel
  siguiente lo dice), no sustituye la serie de la consulta por la del nicho (regla de anclaje de
  arriba), no busca videos en vivo (100 unidades), no crea nichos solo y no dispara las 32
  llamadas DENUE. `GtRelatedPanel` sigue **ocultándose** cuando el nicho activo no tiene ni temas
  ni consultas: ahí no hay ninguna fila real que mostrar y esos mismos datos ya se pintan para la
  búsqueda en vivo más arriba; ocultar evita dos cajas vacías. `GtRegionPanel` y `GeoPanel` no
  tienen listas que llenar: siempre renderizan su declaración de fuente y relación.

### Exportación

Los paneles exportan **en el navegador**, sin ruta nueva (`src/components/inteligencia/intel-export.ts`):
se descarga lo que está en pantalla, no el catálogo completo. El CSV lleva BOM para que Excel
lo abra en UTF-8 y comilla doble escapada en cualquier campo con `,` `"` `;` o salto de línea.

### Estado de verificación (Regla 3)

- **Confirmado mediante pruebas:** las guardas de bandera y de organización, la cadena de
  fallback y la maquinaria de jobs tienen tests unitarios (`tests/unit/api-int-params.test.ts`
  cubre los parámetros de `content`/`trending`). La relación consulta↔catálogo está cubierta
  desde el 22-10-2026 por `tests/unit/intel-relation.test.ts` y por casos nuevos en
  `intel-content.test.ts`, `intel-keyword-anchor.test.ts` e `intel-monitor.test.ts`: catálogo
  completo con score 0, etiquetas de cada panel, franja verde solo para el nicho exacto,
  bloque neutro sin él, y notas del mapa DENUE y de los paneles GT. La regla «nunca vacío» está
  cubierta por `tests/unit/intel-fallback.test.ts` (cadena de niveles, mismo giro, orden por
  alcance, señales de contenido) y por los casos nuevos de `intel-content-scope.test.ts`
  (respaldo `"sample"` y muestra realmente vacía).
- **Detectado mediante inspección:** la degradación de `suggest` y del conector web; dependen
  de endpoints no oficiales. La cadena de respaldo de Tendencias no tiene test de componente
  (sí de sus funciones puras); se deriva de `relateTrendRows` sobre `view.rows`.
- **Pendiente de acceso:** las llamadas reales a SerpApi, Apify, YouTube y DENUE con las
  credenciales de producción. Su contrato está escrito, pero **ninguna fuente externa se ha
  validado desde este entorno**. La comprobación visual de los dos paneles con una búsqueda sin
  coincidencias queda pendiente de un navegador con sesión.

---

## 34. Agenda y Citas (`/bookings`)

### Existencia: la bandera `AGENDA`

`src/server/agenda/flag.ts` documenta la decisión completa (ADR-001, mismo criterio que
`INTEL`): el motor viaja siempre en `main` y `AGENDA` decide si **existe**. Sin bandera no hay
pantalla de Citas, ni pestaña de Ajustes, ni rutas, ni instrucciones de agendar en el prompt
del agente, y no se piden credenciales de nadie. No se hizo con una rama porque una rama tiene
que mantenerse compatible con `main` **y** con las demás features opcionales, y su cadena de
migraciones diverge sin arreglo posible — la prueba está en el propio repo: la rama
`004-motor-agenda` quedó irrescatable en 26 días. La migración se aplica siempre.

**Se llama «Citas», no «Calendario»** (`src/config/nav.ts:54-59`): la pantalla es la lista de
compromisos y su alta, no una rejilla de meses. «Calendario» sigue siendo el nombre de la
pestaña de Ajustes, que es donde se configura el horario. El filtrado se hace en
`navItemsFor({ agenda })` y en un solo sitio para que la barra, los breadcrumbs y el ⌘K nunca
discrepen; el enlace es `agendaOnly` porque sin bandera `/bookings` da 404.

### Motor de disponibilidad

`src/server/agenda/availability.ts`: **horario semanal del negocio − citas activas − bloqueos
manuales**. La expansión del horario a slots UTC es una **función pura** (sin BD), igual que
el reparto por días.

- **Limitación v1 documentada (Constitución VII): no lee calendarios externos.** Es una
  decisión, no un olvido: meter al proveedor en este camino acoplaría su latencia y sus caídas
  a la pantalla que más se usa. Los compromisos de fuera se reflejan con bloqueos manuales.
- **Zona horaria del negocio**, no del navegador: `DEFAULT_TIMEZONE = America/Mexico_City` y
  `DEFAULT_WEEKLY_HOURS` L-V 09:00-18:00 (`settings.ts`), con utilidades en
  `src/lib/time/slots.ts` (`zonedWallClockToUtc`, `labelInTz`, `overlaps`, `weekdayKeyOf`).
- **Reparto entre días** (`spread.ts`): los N huecos más próximos casi siempre caen todos
  *hoy*, y entonces quien conduce la conversación no tiene nada que ofrecer cuando el lead
  dice «¿y el jueves?». `perDay` por día hasta completar `limit`. Además **el catálogo
  reservable es más ancho que el menú que se muestra**: se ofrecen y se registran hasta
  `limit` aunque el agente enseñe tres; guardar solo lo enseñado dejaba al agente sin
  alternativas legítimas que aceptar.

### Las dos reglas innegociables

`src/server/agenda/service.ts` las enuncia arriba del módulo:

1. **Quien conduce la conversación** (agente in-process o cerebro externo) **solo puede
   reservar un instante que ya se ofreció a ESA conversación**: la tabla `offered_slot`
   (`offers.ts`) guarda la memoria de lo ofrecido y la comparación es por **epoch exacto**.
   Sin fila aquí no hay reserva — es lo que impide que un modelo alucine un horario que nunca
   se le ofreció al cliente. La oferta se reemplaza completa en cada ronda (la vigente es la
   última) y se limpia al reservar.
2. **Al confirmar se re-valida el hueco** y la base lo cierra con su **índice único parcial**
   anti doble-booking. Si se ocupó, se responde `slot_taken` con alternativas frescas
   (`FRESH_ALTERNATIVES = 3`) **ya registradas como la nueva oferta** y **no se crea nada**.
   Nunca se confirma una reserva que no se creó.

Y la regla de honestidad: **la entrega de la reunión corre después de escribir la verdad del
CRM y es best-effort**. Si el proveedor está caído, la cita se crea igual con `linkPending` —
un tercero no puede costarnos la conversión, ni hacernos prometer un enlace que no existe.

- `BookingErrorCode`: `slot_taken`, `slot_not_offered`, `not_found`, `invalid`.
- **Conectores** (`src/server/agenda/connectors/`): `google` (con Meet), `zoom`, `enlace-fijo`.
  El alta puede nacer con cualquiera de ellos y `queries.ts` expone `connector` y
  `linkPending` en cada fila.
- **OAuth de Google por redirect** (`google-oauth.ts`): antes el dueño tenía que pescar el
  refresh token a mano. Ahora el CRM abre el consentimiento y lo canjea; el `state` de un solo
  uso vive en `google_oauth_state` **10 minutos** y ata la vuelta de Google a la organización
  que inició el flujo, con el client secret **cifrado**. Sin SDK nuevo: la Constitución no
  admite dependencias para esto.
- **Tareas → Google Calendar** (`tasks-sync.ts`): la otra mitad de la conexión de Google. Es
  **opt-in** (`google_credentials.sync_tasks`, apagado por defecto) y **nunca bloquea**: corre
  después de que la tarea ya está guardada, dentro de un `try/catch` que solo deja un
  diagnóstico. Si Google cae, la tarea queda perfecta y el evento se reintenta en la edición
  siguiente.

### Alta manual desde la pantalla

`POST /api/bookings` es un `z.discriminatedUnion("kind")`: `session` (contacto, hora, nota
opcional, conversación opcional) o `block` (hora, 5-600 minutos, nota). **Responde 201**, como
la superficie del bot. A diferencia del agente, **el operador no pasa por `offered_slot`**:
elige de la disponibilidad que está viendo en pantalla; la re-validación y el candado anti
doble-booking aplican igual, y el servidor sigue validando el hueco (`requireOffer: false` es
una opción del dominio, no una puerta abierta).

`citaStartUtc()` (`src/components/bookings/bookings-client.tsx:43`) existe porque un
`datetime-local` llega **sin zona**: si la hora impuesta a mano se mandara cruda, el servidor
la leería como UTC y la cita quedaría corrida por el offset del operador. El hueco elegido de
la lista ya viene en UTC y se manda tal cual.

### El contrato HTTP, fijado en un módulo

`src/server/agenda/http.ts` vive fuera de los `route.ts` por dos razones: Next solo admite
handlers como exports de una ruta (así que no serían testeables), y los códigos y la **forma**
del error son contrato observable. Las dos lecciones que costaron caro en producción y que
este módulo blinda:

- Crear responde **201, no 200**. Un cliente que validaba `=== 200` dejó a todos los leads sin
  agendar durante horas, y los mocks no lo vieron porque respondían 200.
- El error va **anidado** (`{"error":{"code":…}}`) con `slots` como **hermano**. Un mock con la
  forma plana escondió el camino de re-oferta durante semanas: todo 409 se leía como conflicto
  genérico y las alternativas nunca se ofrecían.

### Agenda en el turno del agente

Con `AGENDA` encendida el prompt recibe el horario real del negocio (días, horas, duración,
zona, buffer) y los huecos que efectivamente se pueden ofrecer. `offer_slots` y `book_slot`
delegan en `src/server/agenda/agent.ts`; `availability.ts` descarta solapamientos, así que
**dos citas encima es imposible**. Las rutas del cerebro externo son `/api/bot/availability` y
`/api/bot/bookings`, con las mismas guardas. **Las citas de prueba nunca llegan a los
conectores** (lo mismo que los mensajes de prueba de los canales).

### Estado de verificación (Regla 3)

- **Confirmado mediante pruebas:** el motor puro de slots, el reparto por días, las guardas
  `requireOffer` / `slot_taken`, el `201` y la forma anidada del error (`tests/unit/
  cita-alta-manual.test.ts`, más las guardas de `/api/bot/availability` y `/api/bot/messages`).
- **Pendiente de acceso:** la creación real de eventos en Google Calendar y Zoom en producción
  — en esta instancia **el token de Google sigue revocado** hasta que el dueño publique la app
  OAuth y reconecte (ver entregable de v1.7.0).

---

## 35. Capas del shell: rail, cabecera y tooltips

El shell (`src/components/app-shell.tsx`) es una fila `flex h-dvh overflow-hidden`. Ese par de
clases es el que decide qué se corta: un hijo que desborde verticalmente **no puede asomar por
encima de un padre con `overflow-hidden`**, y ese padre tampoco puede crecer porque la ventana
ya está agotada. Por eso el rail no puede resolverse con `pt`/`pb` ni con `scale`.

### Mapa de capas (verificado en el CSS compilado de la app)

| Capa | Dónde | `z` |
|---|---|---|
| Fondo del cajón móvil | `app-shell.tsx:101`, `lg:hidden` | `z-40` |
| Cabecera superior | `app-header.tsx:38` (`sticky top-0`) | `z-30` |
| Sub-cabecera del dashboard | `dashboard-client.tsx:178` (`sticky top-0`) | `z-10` |
| **Rail lateral, escritorio** | `app-nav.tsx:157` (`lg:relative lg:z-40`) | `z-40` |
| Cajón lateral, móvil | `app-nav.tsx:156` (`fixed … z-50`) | `z-50` |
| Menú del avatar y globo del tooltip | dentro del `<aside>` | `z-50` |
| Diálogos de página | 27 componentes | `z-50` |
| Paleta de comandos ⌘K | `command-palette.tsx:65` | `z-[70]` |

**Regla práctica: cualquier capa flotante del rail va entre `z-30` y `z-50`.** El globo del
tooltip vive *dentro* del `<aside>`, así que el `z` que compite con la cabecera es el del
contenedor, no el del globo.

### El botón de la trampa: `transform` crea contexto de apilamiento

`lg:translate-x-0` no es un adorno: la versión móvil del rail es un cajón que se desliza con
`-translate-x-full`, y la transición necesita que el estado abierto también declare
`translate-x-0`. **Un `transform` (aunque sea identidad) crea un bloque contenedor y un
contexto de apilamiento**, así que el `z-50` del globo quedaba encerrado y la cabecera `z-30`
del hermano lo pintaba por encima: el nombre del módulo salía recortado («Cont…») y detrás de
la barra superior. La solución no fue sacarlo con un portal ni romper la transición, sino
**darle al rail una capa propia por encima de la cabecera y por debajo de los diálogos**
(`lg:z-40`, nunca `lg:z-auto`), manteniendo el `lg:relative` que hace falta para que ese
`z-index` tenga efecto.

### Geometría: quién hace scroll

El contenido del rail medía ~938 px contra ~801 px de ventana. Ahora **solo el `<nav>` tiene
scroll**: el logo arriba, y el avatar y la versión abajo, quedan anclados y visibles. El globo
del tooltip tuvo que **mudarse del renglón al `<aside>`**: un contenedor con scroll recorta lo
que asoma por su derecha, y por eso el estado `tip` vive en el componente padre y su centro
vertical se calcula con `tooltipTop()` (`app-nav.tsx:39`), una función pura exported.

### Cómo se midió (y dos trampas)

- **`elementFromPoint` nunca devuelve un elemento con `pointer-events-none`.** El globo lo es,
  así que el sonda respondía `cabecera` en las dos variantes y a punto estuvo de reportarse el
  arreglo como ineficaz. La prueba correcta es habilitar `pointerEvents` un instante o leer
  `getComputedStyle().zIndex`.
- **En el viewport de la app (491×593) el branch `lg:` nunca corre**, y `take_screenshot` no
  está disponible. Se midió con el CSS **compilado** de la propia app y las media queries
  `@media (min-width:1024px)` aplanadas, y el recorte se probó con `elementFromPoint`.

### Guardia

`tests/unit/rail-stacking.test.ts` (4 pruebas) parsea el `<aside>` de `app-nav.tsx` y el
`<header>` de `app-header.tsx` y asserts sobre **las cadenas de clase**, no sobre el archivo
entero: el rail declara `lg:z-<dígito>`, está por encima del `z` de la cabecera y por debajo de
50, conserva `lg:relative` / `lg:overflow-visible` / `lg:translate-x-0`, y el globo sigue con
`role="tooltip"` + `z-50` montado dentro del `<aside>`.

> **Lección inversa:** la primera versión tenía `expect(nav).not.toContain("lg:z-auto")` y
> falló porque **el comentario del propio componente explica qué se quitó** (Tailwind llegó a
> emitir la regla por mencionarse en prosa). Un aserto negativo sobre un archivo fuente se
> vuelve contra ti; de ahí que se extraigan las clases antes de comparar.

---

## A. Arquitectura de Agentes (Claude Code)

### Orquestador
- Sesión principal de Claude Code
- Este CLAUDE.md + skill `loop-sdd`

### Subagentes (`.claude/agents/`)

#### `deploy-ops`
- Deploy/logs/healthchecks
- No escribe código de app

#### `public-site-builder`
- Páginas públicas/legales
- Config de paneles externos

---

## B. Memoria Persistente

- **Archivos**: `memory/` (índice `memory/MEMORY.md`)
- **Subagentes**: `.claude/agent-memory/`
- Persiste: decisiones, gotchas, correcciones
- No duplica lo que el repo ya registra

---

## C. Comandos Útiles

```bash
# Typecheck + lint + build + tests
pnpm typecheck && pnpm lint && pnpm build && pnpm test

# Guard de migraciones: journal ↔ archivos .sql (lo que rompe el arranque)
pnpm db:guard

# Generar migración
pnpm db:generate

# Seed de demostración — en multi-tenant el negocio es OBLIGATORIO
pnpm seed:demo --org=<organizationId>

# Tests E2E
pnpm test:e2e

# Verificar migraciones (en producción, dentro del contenedor de la BD)
docker compose exec postgres psql -U postgres -d lumark \
  -c "SELECT COUNT(*) FROM drizzle.__drizzle_migrations;"

# Verificar tablas / datos
docker compose exec postgres psql -U postgres -d lumark -c "\dt"
docker compose exec postgres psql -U postgres -d lumark -c "SELECT COUNT(*) FROM contact;"

# Qué está corriendo de verdad (commit quemado en la imagen)
docker compose exec caddy wget -qO- http://app:3000/api/health
```

---

**Documento generado automáticamente por Claude Code**  
**Última actualización**: 19 de octubre de 2026 — se alinearon §§5, 7, 22, 25-28 y 31 con la
auditoría de ese día (contención de rutas en media, enrutado de WAHA por token, firma
obligatoria de Zernio, alta de organizaciones restringida al dueño de instancia, cabeceras
de respuesta en `next.config.ts`, acceso de Caddy en el log).
