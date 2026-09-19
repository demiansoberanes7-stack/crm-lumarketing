# CRM LUMARK — Documentación Completa del Sistema

**Versión**: 1.4.0  
**Fecha de actualización**: 18 de septiembre de 2026  
**Propietario**: LUMARK / Demian Soberanes  
**Repositorio**: `demiansoberanes7-stack/crm-lumarketing` (GitHub privado)  
**Base**: Vocero CRM (MIT) — `kevinrivm/vocero-crm`

---

## Índice General

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Base de Datos](#4-base-de-datos)
5. [Autenticación y Multi-tenancy](#5-autenticación-y-multi-tenancy)
6. [Canales de Comunicación](#6-canales-de-comunicación)
7. [Sistema de Webhooks](#7-sistema-de-webhooks)
8. [Bandeja de Entrada Unificada](#8-bandeja-de-entrada-unificada)
9. [Agente de IA](#9-agente-de-ia)
10. [Laboratorio de Auto-evaluación](#10-laboratorio-de-auto-evaluación)
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
22. [Sistema de Plantillas](#22-sistema-de-plantillas)
23. [Gestión de Medios](#23-gestión-de-medios)
24. [Branding y Personalización](#24-branding-y-personalización)
25. [Configuración del Sistema](#25-configuración-del-sistema)
26. [Variables de Entorno](#26-variables-de-entorno)
27. [Despliegue con EasyPanel](#27-despliegue-con-easypanel)
28. [Docker y Contenedores](#28-docker-y-contenedores)
29. [Seguridad](#29-seguridad)
30. [Constitución y Reglas](#30-constitución-y-reglas)
31. [Guía de Configuración por Canal](#31-guía-de-configuración-por-canal)
32. [Troubleshooting](#32-troubleshooting)
33. [Glosario](#33-glosario)

---

## 1. Resumen Ejecutivo

**CRM LUMARK** es un CRM de mensajería self-hosted diseñado para negocios que utilizan WhatsApp como canal principal de comunicación con clientes. El sistema está construido sobre Vocero CRM (proyecto open source MIT) y adaptado para las necesidades específicas de LUMARK.

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
- **Despliegue**: Docker multi-stage, EasyPanel (Google Cloud)

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
| EasyPanel | Gestión de contenedores |
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
│                        CRM LUMARK                                │
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

---

## 4. Base de Datos

### Esquema General

La base de datos PostgreSQL contiene **47+ tablas** organizadas en以下 categorías:

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

El sistema utiliza **9 migraciones** (0000-0008) aplicadas automáticamente al iniciar el contenedor:

| # | Nombre | Propósito |
|---|---|---|
| 0000 | baseline | Esquema completo inicial (35+ tablas) |
| 0001 | conversation_identity | Índice único condicional para conversaciones |
| 0002 | charge_quote_unique | Unique index en charge_quote |
| 0003 | project_stages | Tabla dedicada de etapas de proyecto |
| 0004 | archived_and_rename_stages | Columna archived_at + renombrar etapas |
| 0005 | agent_ai_provider | Columnas ai_token y ai_model en agent_profile |
| 0006 | diagnostics_messaging | Tablas diagnostic_event, whatsapp_settings, integration_secret |
| 0007 | agent_ai_token_encrypted | Columnas cifradas para token IA |
| 0008 | tiktok_credentials | Tabla tiktok_credentials |

**Archivos de migración**: `drizzle/0000_baseline.sql` → `drizzle/0008_tiktok_credentials.sql`  
**Journal**: `drizzle/meta/_journal.json`

---

## 5. Autenticación y Multi-tenancy

### Better Auth

El sistema utiliza **Better Auth** con plugin de organizaciones para gestión de usuarios.

#### Configuración (`src/lib/auth/index.ts`)
- **Proveedor**: Email + password (mínimo 8 caracteres)
- **Organizaciones**: Plugin `organization()` con `creatorRole: "owner"`
- **Rate Limiting**: 10 intentos por 10 minutos por IP en login/registro
- **Registro público**: Cerrado después de la primera organización (a menos que `ALLOW_SIGNUP=true`)

#### Hooks de Base de Datos
- **On user create**: `onUserCreated()` crea organización, membresía, etapas del pipeline, perfil del agente
- **On session create**: Resuelve organización activa desde membresía

#### Flujo de Registro
1. Primer usuario crea organización con advisory lock (`pg_advisory_xact_lock`)
2. Se crean 5 etapas predeterminadas del pipeline: Nuevo → En conversación → Interesado → Cliente → Perdido
3. Se crea perfil predeterminado del agente

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
| WhatsApp | 24h | template | Sin límite | Sí | Sí |
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
- **Eventos**: `messages`, `smb_message_echoes`, `message_template_status_update`

#### Instagram + TikTok (`/api/webhooks/ig/[webhookToken]/route.ts`)
- **Gate**: 404 si Instagram y TikTok están deshabilitados
- **Fuentes**: Meta (`object: "instagram"`) + Zernio en la misma URL
- **Meta**: HMAC-SHA256 con `META_APP_SECRET`
- **Zernio**: Secret por cuenta resuelto desde el body

#### Messenger (`/api/webhooks/messenger/[webhookToken]/route.ts`)
- **Gate**: 404 si Messenger está deshabilitado
- **Fuentes**: Meta (`object: "page"`) + Zernio
- **Diferenciación**: `looksLikeMetaPayload()` para distinguir fuentes

#### WAHA (`/api/webhooks/waha/[token]/route.ts`)
- **POST**: Solo POST, delega a `handleWahaWebhook()`
- **Autenticación**: Token HMAC-SHA256 por organización

### Verificación de Webhooks

#### Capa 1: Token de URL
```typescript
isValidWebhookToken(token: string): boolean
// Compara con META_WEBHOOK_VERIFY_TOKEN usando safeEqual()
```

#### Capa 2: Firma HMAC (opcional)
```typescript
isValidSignature(rawBody: string, signature: string | null): boolean
// HMAC-SHA256 del body con META_APP_SECRET
```

#### Seguridad
- `safeEqual()`: Comparación segura contra timing attacks
- Tokens por organización: `wahaWebhookToken(orgId)` genera HMAC de `waha:{orgId}`

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
7. **Actividad de lead**: `onLeadActivity()` crea o actualiza el lead
8. **Eventos SSE**: Publica `message.new` + `conversation.updated`
9. **Agente IA**: `maybeRunAgentTurn()` activa el agente

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
4. Backup regex de handoff ANTES del LLM (red de seguridad)
5. Construye prompt con KB + etapas + slots ofrecidos
6. Llama al LLM
7. Despacha acción

### Acciones del Agente (`src/server/ai/actions.ts`)

Tipos de acción disponibles (discriminated union Zod):
- `none`: Sin acción
- `reply`: Responder al contacto
- `update_lead`: Actualizar información del lead
- `move_stage`: Mover lead a otra etapa
- `handoff`: Transferir a humano
- `offer_slots`: Ofrecer slots de cita
- `book_slot`: Reservar cita

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
- Crea items y evento `created`

#### `updateQuote()`
- Solo en estado `draft`
- Reemplaza todos los items
- Row-level locking

#### `sendQuote()`
- Bloquea cotización (incremento de versión)
- **WhatsApp**: Genera PDF y envía como media
- **Instagram/Messenger**: Envía resumen en texto
- Registra evento `sent`

#### `changeQuoteStatus()`
- Aceptar/rechazar
- Solo desde draft/sent/viewed

### PDF (`src/server/quotes/pdf.ts`)

Utiliza `reportPdf()` de `@/server/documents/pdf`:
- **Librería**: pdf-lib (sin dependencias de navegador)
- **Fuente**: Helvetica
- **Branding**: LUMARK gold (#B8973A)
- **Formato**: Paginado con encabezado y pie

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
Cada ~25 segundos (sobrevive Caddy/Traefik).

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

## 22. Sistema de Plantillas

### Tabla `template`

```typescript
template: {
  id: string
  organizationId: string
  name: string
  category: string         // marketing, utility, authentication
  language: string         // es, en, etc.
  status: string           // APPROVED, PENDING, REJECTED
  components: json         // Componentes de la plantilla
  body: string             // Cuerpo del mensaje
  variables: string[]      // Variables detectadas
}
```

### Funcionalidades

- Importación desde Meta Cloud API
- Renderizado para vista previa
- Envío de plantillas fuera de la ventana de 24h
- Detección automática de variables

---

## 23. Gestión de Medios

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
- Organización por: `{MEDIA_DIR}/{organizationId}/{year}/{month}/{filename}`

---

## 24. Branding y Personalización

### Identidad Visual (`src/lib/brand.ts`)

- **Logo**: Forma geométrica "L" con acento ámbar luminoso
- **Path del body**: `M4 4v16h2.5V11.5H16V9H6.5V4H4z`
- **Path del tail (acento)**: `M12 5h4v2h-4V5z`
- **Stroke width**: 3.4
- **Colores de acento**: `#D4A843` (light bg), `#E8C060` (dark bg)

### Paleta de Colores (`src/lib/branding.ts`)

- **Nombre por defecto**: "LUMARK"
- **Acento por defecto**: `#B8963E` (dorado LUMARK)
- **Moneda**: MXN

#### 5 Presets de Acento

1. **Dorado LUMARK** (default): `#B8963E`
2. **Azul acero**: `#4A6FA5`
3. **Grafito**: `#5C5C5C`
4. **Verde apagado**: `#5A7A5A`
5. **Ciruela**: `#7A4A6A`

### Variables CSS

```css
--accent: #B8963E        /* Color principal */
--accent-hover: #A68634  /* Hover state */
--accent-soft: #F5ECD6   /* Fondo suave */
--accent-tint: #FBF7EC   /* Tinte más claro */
--accent-text: #7A6428   /* Texto sobre fondo claro */
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

---

## 25. Configuración del Sistema

### Páginas de Configuración

| Ruta | Descripción |
|---|---|
| `/settings` | Redirige a `/settings/whatsapp` |
| `/settings/whatsapp` | Wizard de WhatsApp Cloud API |
| `/settings/waha` | Configuración de WAHA |
| `/settings/instagram` | Configuración de Instagram |
| `/settings/messenger` | Configuración de Messenger |
| `/settings/tiktok` | Configuración de TikTok |
| `/settings/templates` | Gestión de plantillas WhatsApp |
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

## 26. Variables de Entorno

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

### IA (OpenRouter/Groq)

```bash
OPENROUTER_BASE_URL=https://api.groq.com/openai/v1
OPENROUTER_API_TOKEN=<api-key>
OPENROUTER_MODEL=llama-3.3-70b-versatile
OPENROUTER_JUDGE_MODEL=llama-3.3-70b-versatile
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
```

### Medios

```bash
MEDIA_DIR=/data/media
```

### Agent

```bash
AGENT_COALESCE_MS=6000
```

---

## 27. Despliegue con EasyPanel

### Infraestructura Actual

- **VPS**: Google Cloud (`demiansoberanes7@lumarkgroup`)
- **Sistema**: Ubuntu 26.04
- **Panel**: EasyPanel
- **Dominio CRM**: `https://crm-crm.or7bqd.easypanel.host`
- **Dominio WAHA**: `https://chatbot-waha.or7bqd.easypanel.host`

### Pasos de Despliegue

#### 1. PostgreSQL 16
- Servicio EasyPanel con almacenamiento persistente
- URL interna: `postgresql://postgres:1234@crm_bd:5432/CRM?sslmode=disable`
- **⚠️ IMPORTANTE**: Usar conexión interna (`crm_bd`), NO host externo

#### 2. Servicio de App
- Repo: `demiansoberanes7-stack/crm-lumarketing` (privado)
- Branch: `main`
- Build: Dockerfile multi-stage
- Puerto: 3000

#### 3. Variables de Entorno
```
NODE_ENV=production
APP_BASE_URL=https://CRM-DOMAIN
DATABASE_URL=INTERNAL-PG-URL
BETTER_AUTH_SECRET=<random>
ENCRYPTION_KEY=<random>
META_WEBHOOK_VERIFY_TOKEN=<random>
CHANNELS=whatsapp,instagram,messenger
MEDIA_DIR=/data/media
```

#### 4. Volúmenes Persistentes
- Montar `/data/media` con permisos de escritura para usuario `lumark`

#### 5. Verificación
- Health check: `/api/health`
- Registrar usuario
- Configurar WAHA en settings
- Escanear QR
- Verificar sesión WORKING

### Configuración de Webhooks WAHA

- **Importante**: Si la sesión WAHA ya existe antes del deploy, se necesita actualización manual
- Auto-registro solo ocurre en nuevas sesiones desde el CRM

---

## 28. Docker y Contenedores

### Dockerfile (Multi-stage)

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 lumark
RUN adduser --system --uid 1001 lumark
COPY --from=builder --chown=lumark:lumark /app/.next/standalone ./
COPY --from=builder --chown=lumark:lumark /app/.next/static ./.next/static
COPY --from=builder --chown=lumark:lumark /app/public ./public
USER lumark
EXPOSE 3000
CMD ["node", "server.js"]
```

### Health Check

```
GET /api/health
```

Retorna status 200 si el sistema está operativo.

### Contenedores en el VPS

| Contenedor | Descripción |
|---|---|
| `crm_crm.1.*` | Aplicación CRM |
| `crm_bd.1.*` | PostgreSQL 16 |
| `crm_bd_pgweb.1.*` | pgweb (interfaz web para BD) |
| `easypanel.1.*` | EasyPanel |
| `easypanel-traefik.1.*` | Traefik (proxy inverso, puertos 80/443) |
| `chatbot_waha` | WAHA (WhatsApp HTTP API) |
| `chatbot_n8n` | n8n (automatizaciones) |
| `chatbot_evolution-api` | Evolution API |

---

## 29. Seguridad

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

#### WAHA
- Token HMAC-SHA256 por organización
- Generado: `wahaWebhookToken(orgId)` = HMAC de `waha:{orgId}`

#### Zernio
- Firma HMAC-SHA256 del body
- Headers: `x-zernio-signature` (primario), `x-late-signature` (legacy)

### Rate Limiting

- Login/Register: 10 intentos por 10 minutos por IP
- Implementación: Better Auth内置

### Validación de URLs WAHA (`src/server/waha/url.ts`)

```typescript
privateAddress(ip: string): boolean
// Detecta IPs privadas/loopback (RFC 1918, link-local, multicast)

validateWahaUrl(url: string): void
// Requiere HTTPS para hosts públicos
// Bloquea IPs privadas除非 estén en WAHA_TRUSTED_HOSTS
```

### Tower of Hanoi de Seguridad

1. **Capa 1**: Autenticación de usuario (Better Auth)
2. **Capa 2**: Multi-tenancy (scoped queries)
3. **Capa 3**: Cifrado en reposo (AES-256-GCM)
4. **Capa 4**: Rate limiting
5. **Capa 5**: Validación de inputs (Zod)
6. **Capa 6**: Webhook verification (HMAC)

---

## 30. Constitución y Reglas

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

## 31. Guía de Configuración por Canal

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

## 32. Troubleshooting

### El CRM no carga

1. Verificar health check: `curl https://crm-domain/api/health`
2. Verificar logs en EasyPanel
3. Verificar conexión a BD en EasyPanel console
4. Verificar que las migraciones se aplicaron (deberían ser 9)

### Webhooks no llegan

1. Verificar URL del webhook en la plataforma externa
2. Verificar token en la URL
3. Verificar firma HMAC si está configurada
4. Verificar logs de diagnóstico en Settings → Diagnostics

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

1. Verificar logs de EasyPanel deploy
2. Verificar errores de TypeScript: `pnpm typecheck`
3. Verificar errores de lint: `pnpm lint`
4. Commit fix y push para rebuild automático

### BD no conecta

1. Verificar `DATABASE_URL` en variables de entorno
2. Verificar que PostgreSQL está corriendo
3. Verificar que el host es el interno (`crm_bd`), no externo
4. Verificar credenciales (user: postgres, password: 1234 por defecto)

---

## 33. Glosario

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
| **EasyPanel** | Panel de gestión de contenedores Docker |
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

# Generar migración
pnpm db:generate

# Tests E2E
pnpm test:e2e

# Verificar migraciones
psql -c "SELECT COUNT(*) FROM drizzle.__drizzle_migrations;"

# Verificar tablas
psql -c "\dt"

# Verificar datos
psql -c "SELECT COUNT(*) FROM contact;"
psql -c "SELECT COUNT(*) FROM conversation;"
psql -c "SELECT COUNT(*) FROM message;"
```

---

**Documento generado automáticamente por Claude Code**  
**Última actualización**: 18 de septiembre de 2026
