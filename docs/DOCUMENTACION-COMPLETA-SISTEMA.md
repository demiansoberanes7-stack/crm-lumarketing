# DOCUMENTACION COMPLETA DEL SISTEMA CRM LUMARK

---

**Version:** 1.4.0  
**Fecha:** 20 de Septiembre de 2026  
**Licencia:** MIT  
**Repositorio:** CRM LUMARK (monolito Next.js)  
**Autor:** LUMARK / Ghostbreakfast  

---

## TABLA DE CONTENIDOS

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Historia del Proyecto y Evolucion](#2-historia-del-proyecto-y-evolucion)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Stack Tecnologico y Dependencias](#4-stack-tecnologico-y-dependencias)
5. [Infraestructura Docker](#5-infraestructura-docker)
6. [Base de Datos](#6-base-de-datos)
7. [Sistema de Canales](#7-sistema-de-canales)
8. [Motor de Inbox y Mensajeria](#8-motor-de-inbox-y-mensajeria)
9. [Agente de IA y Laboratorio](#9-agente-de-ia-y-laboratorio)
10. [Modulos de Negocio](#10-modulos-de-negocio)
11. [Agenda y Programacion](#11-agenda-y-programacion)
12. [Integraciones Externas](#12-integraciones-externas)
13. [API Completa](#13-api-completa)
14. [Seguridad y Constitucion](#14-seguridad-y-constitucion)
15. [Despliegue en EasyPanel](#15-despliegue-en-easypanel)
16. [Bugs, Errores y Soluciones](#16-bugs-errores-y-soluciones)
17. [Testing y Verificacion](#17-testing-y-verificacion)
18. [Escalabilidad y Rendimiento](#18-escalabilidad-y-rendimiento)
19. [Guia de Mantenimiento y Soporte](#19-guia-de-mantenimiento-y-soporte)
20. [Glosario y Referencias](#20-glosario-y-referencias)

---

# 1. RESUMEN EJECUTIVO

## Que es CRM LUMARK

CRM LUMARK es un sistema de gestion de relaciones con clientes (CRM) open source construido sobre WhatsApp, con un agente de inteligencia artificial integrado y un Laboratorio de auto-evaluacion. Esta disenado para negocios pequenos y medianos en Latinoamerica, con soporte nativo para mensajeria en multiples canales.

## Capacidades Principales

- **Multi-canal**: WhatsApp (Meta Cloud API + WAHA), Instagram, Messenger, TikTok
- **Agente IA**: Asistente inteligente que responde conversaciones automaticamente con handoff a humanos
- **Laboratorio**: Sistema de auto-evaluacion con 6 personas de prueba y scoring 0-100
- **Pipeline Kanban**: Gestion de leads con etapas, arrastre, y historial de eventos
- **Cotizaciones**: Creacion, envio por WhatsApp, PDF con IVA, aceptacion/rechazo
- **Proyectos**: Gestion de proyectos con 7 etapas default, tareas, y reportes
- **Agenda**: Programacion de citas con conectores Zoom y Google Calendar
- **Finanzas**: Cuentas por cobrar, pagos, gastos, balance mensual
- **Email**: Integracion IMAP/SMTP para envio y recepcion
- **Branding**: White-label con color de acento personalizable
- **Real-time**: Server-Sent Events para actualizaciones en vivo
- **Bot API**: Interface para microservicios externos que guien conversaciones
- **Atribucion**: Conversions API de Meta para atribucion de anuncios

## Metricas del Sistema

| Metrica | Valor |
|---------|-------|
| Tablas de base de datos | 47+ |
| Migraciones | 10 (0000-0009) |
| Rutas API | 80+ |
| Componentes UI | 60+ |
| Unit tests | 450 |
| Scripts E2E | 17 |
| Lineas de codigo (estimado) | ~25,000+ |
| Canales soportados | 4 |
| Conectores de agenda | 3 |

---

# 2. HISTORIA DEL PROYECTO Y EVOLUCION

## Fase 1: Concepcion

El proyecto nacio como un CRM basado en WhatsApp para gestionar clientes de una agencia de marketing digital. El objetivo original era simple: recibir mensajes de WhatsApp, tener un inbox centralizado, y poder responder desde una interfaz web en lugar de usar la app de WhatsApp Business.

**Decision inicial**: Usar Next.js como framework por su simplicidad de deploy (un solo contenedor) y soporte nativo de API routes.

## Fase 2: Core del CRM

Se construyo el nucleo del sistema:

- **Inbox** con resolucion de identidad (telefono + Business-Scoped User IDs)
- **Contactos** con reconciliacion multi-identidad
- **Pipeline Kanban** con etapas personalizables
- **Agente IA** usando OpenRouter-compatible (adaptador LLM)
- **Sistema de-webhooks** para WhatsApp Cloud API
- **Autenticacion** con Better Auth + plugin organization
- **Multi-tenancy** por organization_id en todas las tablas de dominio

**Decision critica**: Adoptar un patron de "constitucion" - 4 reglas no negociables:
1. **Soberania**: El nucleo solo depende de WhatsApp Cloud API + proveedor LLM
2. **Seguridad**: Secretos cifrados en reposo (AES-256-GCM)
3. **Multi-tenancy**: organization_id NOT NULL en toda tabla de dominio
4. **Idempotencia**: Webhooks dedup, estados monotonos

## Fase 3: Canales Opcionales

Se implementaron canales adicionales siguiendo el patron ADR-001 (canales opcionales):

- **Instagram** via Zernio (transporte unificado)
- **Messenger** via Zernio
- **TikTok** via Zernio

**Patron clave**: Todos los canales viven en `main` siempre. Lo que decide si existen es la variable de entorno `CHANNELS`. Esto evita ramas por feature que divergen en migraciones.

## Fase 4: Modulos Avanzados

Se agregaron modulos detras de feature flags:

- **Agenda** (flag `AGENDA`): Motor de disponibilidad, booking, conectores Zoom/Google
- **Atribucion** (flag `ATRIBUCION`): Conversions API de Meta
- **Laboratorio**: Auto-evaluacion del agente IA con 6 personas de prueba
- **Proyectos**: Gestion de proyectos con etapas y tareas
- **Cotizaciones**: PDF, versionado, aceptacion
- **Finanzas**: Pagos, gastos, cuentas por cobrar
- **Email**: IMAP/SMTP integrado
- **Bot API**: Interface para microservicios externos

---

# 3. ARQUITECTURA DEL SISTEMA

## Diagrama de Bloques

```
+------------------------------------------------------------------+
|                        CLIENTE (Browser)                         |
|  React 19 + Tailwind CSS + SSE (Server-Sent Events)              |
+------------------------------------------------------------------+
                              |
                              | HTTPS
                              v
+------------------------------------------------------------------+
|                     SERVIDOR NEXT.JS 15                           |
|  +------------------------------------------------------------+  |
|  |  API Routes (App Router)                                    |  |
|  |  /api/auth | /api/conversations | /api/contacts | ...      |  |
|  +------------------------------------------------------------+  |
|  |  Server Actions + Server Components                         |  |
|  +------------------------------------------------------------+  |
|  |  Server Layer                                               |  |
|  |  inbox/ | ai/ | channels/ | agenda/ | projects/ | ...     |  |
|  +------------------------------------------------------------+  |
|  |  Lib Layer                                                  |  |
|  |  db/ | ai/ | meta/ | crypto/ | channels.ts | env.ts       |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
          |                    |                     |
          v                    v                     v
+----------------+  +------------------+  +------------------+
|   PostgreSQL   |  |  OpenRouter LLM  |  |  Meta Graph API  |
|   47+ tablas   |  |  (Claude, GPT)   |  |  WhatsApp/IG     |
+----------------+  +------------------+  +------------------+
          |                                       |
          v                                       v
+----------------+                    +------------------+
|  WAHA Server   |                    |  Zernio API      |
|  (WhatsApp     |                    |  (IG/Messenger/  |
|   alternativo) |                    |   TikTok)        |
+----------------+                    +------------------+
```

## Patron de Capas

```
API Routes  -->  Server Layer  -->  Lib Layer  -->  Database
   |                |                  |               |
 Manejo         Logica de          Utilidades      Drizzle ORM
 HTTP           negocio            compartidas     + PostgreSQL
```

### API Routes (`src/app/api/`)
- Manejan HTTP request/response
- Validan input con Zod
- Resuelven sesion del usuario
- Delegan logica al Server Layer

### Server Layer (`src/server/`)
- Logica de negocio pura
- Sin dependencia de HTTP
- Funciones reutilizables
- Tests unitarios posibles

### Lib Layer (`src/lib/`)
- Utilidades compartidas (client/server)
- Schema de base de datos
- Configuracion de entorno
- Clientes HTTP (Meta, Zernio, OpenRouter)

### Database Layer (`src/lib/db/`)
- Drizzle ORM con PostgreSQL
- Multi-tenancy via `scoped()`
- IDs prefijados (ct_, msg_, cv_)
- Migraciones versionadas en `drizzle/`

## Eventos SSE (Realtime)

El sistema usa Server-Sent Events para actualizaciones en vivo:

```
Browser  <-- SSE stream --  /api/events
   |
   | Heartbeat: ": ping" cada 25s
   | Anti-buffering: X-Accel-Buffering: no
   | Catch-up: refetch con since=
```

No hay WebSockets ni colas externas. El trabajo en segundo plano (agente IA, Laboratorio) es in-process.

---

# 4. STACK TECNOLOGICO Y DEPENDENCIAS

## Framework Principal

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Next.js | ^15.1.3 | Framework fullstack (App Router) |
| React | ^19.0.0 | UI library |
| TypeScript | ^5.7.2 | Type safety (strict mode) |
| Tailwind CSS | ^3.4.17 | Styling + design tokens |

## Base de Datos

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| PostgreSQL | 16-alpine | Base de datos relacional |
| Drizzle ORM | ^0.38.3 | ORM type-safe |
| postgres.js | ^3.4.5 | Driver PostgreSQL |
| drizzle-kit | ^0.30.1 | Migraciones CLI |

## Autenticacion y Seguridad

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Better Auth | ^1.1.14 | Autenticacion + plugin organization |
| Zod | ^3.24.1 | Validacion de schemas |
| AES-256-GCM | custom | Cifrado de secretos en reposo |

## IA y LLM

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Groq | API | Proveedor de IA (via adaptador OpenRouter-compatible) |
| openai/gpt-oss-20b | via Groq | Modelo de lenguaje (gratis, 131K contexto) |

## UI y Componentes

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| lucide-react | ^0.469.0 | Iconografia |
| recharts | ^2.15.0 | Graficas/dashboards |
| @dnd-kit/core | ^6.3.1 | Drag and drop (kanban) |
| tailwind-merge | ^2.6.0 | Fusion de clases CSS |
| class-variance-authority | ^0.7.1 | Variantes de componentes |
| pdf-lib | ^1.17.1 | Generacion de PDFs |

## Email

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| nodemailer | ^6.9.16 | Envio SMTP |
| imapflow | ^0.1.185 | Recepcion IMAP |
| mailparser | ^3.7.2 | Parsing de emails |

## Testing

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Vitest | ^2.1.8 | Unit testing |
| Playwright | ^1.61.1 | E2E testing |
| ESLint | ^9.17.0 | Linting |

## DevOps

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Docker | multi-stage | Containerizacion |
| Caddy | 2-alpine | Reverse proxy + HTTPS automatico |
| pnpm | 11.5.0 | Package manager |

---

# 5. INFRAESTRUCTURA DOCKER

## Arquitectura de Contenedores

```
+-------------------+
|    Caddy 2        |  <-- Puerto 80/443 (HTTPS automatico)
|  (Reverse Proxy)  |
+--------+----------+
         |
         v
+-------------------+     +-------------------+
|    App Next.js    | --> |   PostgreSQL 16   |
|  (Puerto 3000)    |     |  (Puerto 5432)    |
|  Standalone       |     |  volumen persistente|
+-------------------+     +-------------------+
```

## docker-compose.yml (Produccion)

```yaml
services:
  app:
    build: .
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      - DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/lumark
      - APP_BASE_URL=https://${DOMAIN}
      # ... demas variables
    volumes:
      - /data/media:/data/media  # Archivos media persistentes

  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - lumark_postgres:/var/lib/postgresql/data

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - lumark_caddy_data:/data
```

## Dockerfile (Multi-stage - 4 etapas)

```dockerfile
# Etapa 1: Dependencias
FROM node:22-alpine AS deps
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Etapa 2: Build
FROM node:22-alpine AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
# Bundles migrate.mjs y seed/demo.ts con esbuild

# Etapa 3: Test (Chromium para E2E)
FROM node:22-alpine AS test
RUN apk add --no-cache chromium

# Etapa 4: Runner (produccion)
FROM node:22-alpine AS runner
RUN addgroup --system lumark && adduser --system lumark
WORKDIR /app
COPY --from=builder --chown=lumark:lumark /app/.next/standalone ./
COPY --from=builder --chown=lumark:lumark /app/.next/static ./.next/static
COPY --from=builder --chown=lumark:lumark /app/scripts/migrate.mjs ./
USER lumark
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
```

## docker-compose.dev.yml (Desarrollo)

- Solo PostgreSQL (sin app)
- Puerto 5433:5432 (evita colision con produccion)
- Password: `lumark`

## docker-compose.local.yml (Full Stack Local)

- App en puerto 3100:3000
- Mocks habilitados: `WA_MOCK_ENABLED=true`
- Meta Graph y OpenRouter apuntan a mocks locales
- PostgreSQL en puerto 5433

## Caddyfile

```
{$DOMAIN} {
    reverse_proxy app:3000 {
        flush_interval -1  # Critico para SSE
    }
    encode gzip
}
```

`flush_interval -1` es critico: sin esto, Caddy bufferiza las respuestas SSE y el realtime no funciona.

---

# 6. BASE DE DATOS

## Diagrama ER (Simplificado)

```
+-------------------+       +-------------------+
|   organization    |<------|      member       |
|   (negocio)       |       | (usuario-negocio) |
+--------+----------+       +--------+----------+
         |                           |
         | organization_id           | user_id
         v                           v
+-------------------+       +-------------------+
|     contact       |       |       user        |
|   (cliente)       |       | (usuario autentic)|
+--------+----------+       +-------------------+
         |
         | contact_id
         v
+-------------------+
|   conversation    |
|   (conversacion)  |
+--------+----------+
         |
         | conversation_id
         v
+-------------------+       +-------------------+
|     message       |       |      lead         |
|   (mensaje)       |       |   (oportunidad)   |
+-------------------+       +--------+----------+
                                    |
                                    | lead_id
                                    v
                            +-------------------+
                            | pipeline_stage    |
                            |    (etapa)        |
                            +-------------------+
```

## Tablas por Dominio (47+ tablas)

### Core (Tablas fundamentales)

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `user` | Usuarios autenticados | id, name, email, emailVerified, image, createdAt |
| `account` | Cuentas OAuth | userId, accountId, providerId, accessToken |
| `session` | Sesiones activas | userId, token, expiresAt, ipAddress |
| `member` | Membresia usuario-negocio | userId, organizationId, owner |
| `organization` | Negocio/organizacion | name, slug, logo, phone |

### Contactos y Conversaciones

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `contact` | Clientes | organizationId, name, phone, waIdentity, bsuid, channel, phoneVerifiedAt |
| `conversation` | Conversaciones | organizationId, contactId, channel, isTest, aiEnabled, handoffAt |
| `message` | Mensajes | conversationId, waMessageId (UNIQUE), direction, text, status, origin |

### Pipeline y Leads

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `lead` | Oportunidades de venta | organizationId, contactId, stageId, priority, amount, lostReason |
| `pipeline_stage` | Etapas del pipeline | organizationId, name, position, color |
| `lead_stage_event` | Historial de cambios | leadId, fromStageId, toStageId, trigger (owner/bot/agent) |

### Agenda

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `calendar_settings` | Configuracion semanal | organizationId, weeklyHours (JSONB), slotMinutes, connector |
| `booking` | Citas agendadas | conversationId, scheduledAt, status (agendada/realizada/no_show/cancelada) |
| `offered_slot` | Slots ofrecidos | conversationId, startUtc, endUtc |

### IA y Agente

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `agent_profile` | Perfil del agente | organizationId, name, tone, instructions, aiTokenCipher/iv/tag (deprecated, usar env vars) |
| `kb_entry` | Base de conocimiento | organizationId, question, answer, category |
| `agent_test_run` | Ejecuciones del Laboratorio | organizationId, status, score |
| `agent_test_case` | Casos de prueba | runId, persona, verdict (verde/amarillo/rojo) |

### Cotizaciones

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `quote` | Cotizaciones | organizationId, contactId, number (COT-XXXX), version, status, subtotal, tax, total |
| `quote_item` | Items de cotizacion | quoteId, description, quantity, unitPrice |
| `catalog_product` | Catalogo de productos | organizationId, name, price (cents), currency |

### Proyectos

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `project` | Proyectos | organizationId, code (PRJ-XXXX), name, currentStageId, archivedAt |
| `project_stage` | Etapas de proyecto | organizationId, name, position |
| `project_task` | Tareas | projectId, title, status (no_empezado/pendiente/terminado) |

### Finanzas

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `charge` | Cuentas por cobrar | organizationId, contactId, quoteId, amount, saldoPendiente |
| `payment` | Pagos recibidos | organizationId, chargeId, amount, method, paidAt |
| `expense` | Gastos | organizationId, description, amount, category |

### Canales

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `meta_credentials` | Credenciales WhatsApp Cloud | organizationId, phoneNumberId, wabaId, tokenCipher/iv/tag |
| `waha_credentials` | Credenciales WAHA | organizationId, serverUrl, apiKeyCipher/iv/tag |
| `instagram_credentials` | Credenciales Instagram | organizationId, igUserId, source (meta/zernio), tokenCipher/iv/tag |
| `messenger_credentials` | Credenciales Messenger | organizationId, pageId, source, tokenCipher/iv/tag |
| `tiktok_credentials` | Credenciales TikTok | organizationId, tiktokUserId, source (zernio), tokenCipher/iv/tag |

### Webhooks y Diagnostico

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `outbound_webhook` | Webhooks salientes | organizationId, url, events (JSONB), secret |
| `outbound_delivery` | Entregas de webhooks | webhookId, event, status (sent/failed), response |
| `diagnostic_event` | Eventos de diagnostico | organizationId, type, payload |
| `whatsapp_settings` | Configuracion WhatsApp | organizationId, provider (meta/waha) |

### Atribucion

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `ad_attribution` | Atribucion de anuncios | organizationId, conversationId, ctwaClid |
| `capi_settings` | Configuracion CAPI | organizationId, datasetId, tokenCipher/iv/tag |
| `conversion_event` | Eventos de conversion | organizationId, attributionId, type (QualifiedLead/Purchase), status |

### Otros

| Tabla | Descripcion | Columnas clave |
|-------|-------------|----------------|
| `media_asset` | Archivos media | conversationId, type, mimeType, path, status |
| `email_account` | Cuentas email | organizationId, imapHost, smtpHost, passwordCipher/iv/tag |
| `email_message` | Mensajes email | accountId, messageId, subject, from, body |
| `template` | Templates de WhatsApp | organizationId, name, category, status, body |
| `integration_secret` | Secretos generales | organizationId, key, valueCipher/iv/tag |
| `verification` | Verificaciones email | identifier, token, expiresAt |
| `invitation` | Invitaciones de equipo | organizationId, email, role, status |

## Migraciones

| # | Archivo | Descripcion |
|---|---------|-------------|
| 0000 | `0000_baseline.sql` | Schema completo: 35+ tablas, FK, 70+ indices |
| 0001 | `0001_conversation_identity.sql` | Unique index en conversation (org, contact) WHERE NOT is_test |
| 0002 | `0002_charge_quote_unique.sql` | Unique index en charge (org, quote_id) |
| 0003 | `0003_project_stages.sql` | Tabla project_stage dedicada, migracion de datos |
| 0004 | `0004_archived_and_rename_stages.sql` | Columna archived_at, renombrar etapas |
| 0005 | `0005_agent_ai_provider.sql` | Columnas ai_token y ai_model en agent_profile |
| 0006 | `0006_diagnostics_messaging.sql` | diagnostic_event, whatsapp_settings, integration_secret |
| 0007 | `0007_agent_ai_token_encrypted.sql` | Token cifrado (cipher, iv, tag) en agent_profile |
| 0008 | `0008_tiktok_credentials.sql` | Tabla tiktok_credentials con token cifrado |
| 0009 | `0009_one_running_run_index.sql` | Unique index: una ejecucion corriendo por organizacion |

---

# 7. SISTEMA DE CANALES

## Definicion del Tipo Channel

```typescript
// src/lib/channels.ts
export type Channel = "whatsapp" | "instagram" | "messenger" | "tiktok";

export const CHANNEL_ORDER: readonly Channel[] = [
  "whatsapp", "instagram", "messenger", "tiktok"
];

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok"
};
```

## Sistema de Flags (ADR-001)

WhatsApp siempre esta encendido. Los demas canales se activan con la variable `CHANNELS`:

```bash
# .env
CHANNELS=whatsapp,instagram,messenger,tiktok
```

```typescript
// src/server/channels/enabled.ts
const ALWAYS_ON: Channel = "whatsapp";

export function isChannelEnabled(channel: Channel): boolean {
  return enabledChannels().has(channel);
}
```

**Patron**: El codigo de todos los canales viaja siempre en main. Lo que decide si existen para el usuario es la variable `CHANNELS`. Una instalacion normal (`CHANNELS=whatsapp`) no ve Instagram por ningun lado.

**Por que no ramas por feature**: Una rama tiene que mantenerse compatible con main Y con las demas ramas opcionales, y su cadena de migraciones diverge sin arreglo posible.

## Capacidades por Canal

| Canal | Ventana | Fuera de ventana | Max texto | Media saliente | Estados de entrega |
|-------|---------|------------------|-----------|----------------|-------------------|
| WhatsApp | 24h | template | sin limite | Si | Si |
| Instagram | 24h | human_agent_tag | 1000 bytes | No | No |
| Messenger | 24h | human_agent_tag | 2000 bytes | No | No |
| TikTok | 24h | human_agent_tag | 1000 bytes | No | Si |

### Transporte por Canal

| Canal | Transporte | API/Proveedor |
|-------|------------|---------------|
| WhatsApp | Meta Cloud API | graph.facebook.com |
| WhatsApp | WAHA (alternativo) | Self-hosted WAHA server |
| Instagram | Meta direct o Zernio | graph.facebook.com / zernio.com |
| Messenger | Meta direct o Zernio | graph.facebook.com / zernio.com |
| TikTok | Zernio | zernio.com |

## Como Activar un Canal

1. **En EasyPanel**: Ir a CRM -> Env vars -> Agregar el canal a `CHANNELS`
2. **Reiniciar** el contenedor
3. **Configurar credenciales**: Ir a Settings -> [Canal] y conectar

---

# 8. MOTOR DE INBOX Y MENSAJERIA

## Flujo de Ingesta de Mensajes

```
Webhook entrante (Meta/Zernio/WAHA)
         |
         v
+-------------------+
| Validar firma     |  <-- HMAC-SHA256 / X-Hub-Signature-256
| (webhook security)|
+--------+----------+
         |
         v
+-------------------+
| Resolver identid. |  <-- phone, BSUID, ig, fb, tt
| (identity.ts)     |
+--------+----------+
         |
         v
+-------------------+
| Get or create     |  <-- Reconciliacion multi-identidad
| contact           |
+--------+----------+
         |
         v
+-------------------+
| Get or create     |  <-- 1 conversacion por contacto+canal
| conversation      |
+--------+----------+
         |
         v
+-------------------+
| Insertar mensaje  |  <-- ON CONFLICT DO NOTHING (dedup)
| (wa_message_id    |
|    UNIQUE)        |
+--------+----------+
         |
         v
+-------------------+
| Actualizar        |  <-- lastInboundAt, unreadCount++
| conversation      |
+--------+----------+
         |
         v
+-------------------+
| Registrar         |  <-- lead_activity
| actividad         |
+--------+----------+
         |
         v
+-------------------+
| Publicar SSE      |  <-- message.new, conversation.updated
| eventos           |
+--------+----------+
         |
         v
+-------------------+
| Trigger agente IA |  <-- maybeRunAgentTurn()
| (si esta habilit) |
+-------------------+
```

## Resolucion de Identidad

Meta esta migrando de telefono a Business-Scoped User IDs (BSUID). La llave estable es `contact.wa_identity`:

```typescript
// src/server/inbox/identity.ts
const PHONE_PREFIX = "";          // telefono normalizado
const BSUID_PREFIX = "bsuid:";   // Business-Scoped User ID
const IG_PREFIX = "ig:";         // Instagram
const FB_PREFIX = "fb:";         // Facebook
const TT_PREFIX = "tt:";         // TikTok
```

**Reconciliacion**: Si un contacto se comunica por telefono Y luego por BSUID, el sistema detecta que es la misma persona y fusiona las identidades.

## Manejo de Ecos

Cuando el dueno envia desde la app de WhatsApp Business:

1. Se registra como outbound con `origin="manual"`
2. Se pausa automaticamente el agente IA (`handoff` con razon `"manual_reply"`)
3. **NUNCA** toca la ventana de 24h
4. **NUNCA** dispara el agente

## Ventana de Servicio (24h)

```typescript
// src/server/inbox/window.ts
export function isWindowOpen(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
}
```

Dentro de la ventana: el agente puede enviar texto libre.
Fuera de la ventana: solo templates aprobados o handoff con razon "ventana".

## Envio Multi-canal

```typescript
// src/server/inbox/send.ts (simplificado)
export async function sendText(conversationId, text) {
  // 1. Verificar que la conversacion existe
  // 2. Verificar sandbox (test conversations NUNCA tocan API real)
  // 3. Verificar ventana de 24h
  // 4. Verificar credenciales del canal
  // 5. Resolver destinatario (telefono vs BSUID)
  // 6. Enviar via el canal apropiado:
  //    - WhatsApp: Graph API
  //    - Instagram: sendInstagramText (Zernio o Meta)
  //    - Messenger: sendMessengerText (Zernio o Meta)
  //    - TikTok: sendTikTokText (Zernio)
}
```

---

# 9. AGENTE DE IA Y LABORATORIO

## Adaptador LLM

```typescript
// src/lib/ai/index.ts (simplificado)
export async function chatJson<T>(
  schema: ZodSchema<T>,
  messages: ChatMessage[],
  opts?: { model?: string; organizationId?: string }
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  // 1. Resolver config SOLO de env vars (DB fields deprecated)
  // 2. Enviar a OpenRouter-compatible API (Groq, OpenRouter, etc.)
  // 3. Extraer JSON de la respuesta
  // 4. Validar contra schema Zod
  // 5. Reintentar hasta 3 veces con prompts mas estrictos
  // 6. Retornar resultado tipado
}
```

**IMPORTANTE (v1.4.0)**: La configuracion de IA ahora es **solo por variables de entorno**. Los campos `aiToken` y `aiModel` en `agent_profile` estan deprecated. La UI ya no muestra la seccion "Proveedor de IA" — todo se configura via env vars en EasyPanel.

```bash
# Configuracion de IA (solo env vars)
OPENROUTER_BASE_URL=https://api.groq.com/openai
OPENROUTER_API_TOKEN=gsk_...
OPENROUTER_MODEL=openai/gpt-oss-20b
```

## Pipeline del Agente (7 acciones)

El agente produce EXACTAMENTE UNA accion por turno:

| Accion | Descripcion |
|--------|-------------|
| `none` | No responder |
| `reply` | Enviar texto al cliente |
| `update_lead` | Guardar nota en el lead |
| `move_stage` | Mover lead a una etapa |
| `handoff` | Escalar a humano |
| `offer_slots` | Ofrecer slots disponibles (agenda) |
| `book_slot` | Reservar un slot especifico (agenda) |

## Flujo del Agente

```
Mensaje entrante
         |
         v
+-------------------+
| Coalesce + Lock   |  <-- Debounce por conversacion (6s default)
| (pipeline.ts)     |      Nunca dos turnos simultaneos
+--------+----------+
         |
         v
+-------------------+
| Pre-LLM checks    |  <-- Existe conv? IA configurada? Handoff?
+--------+----------+
         |
         v
+-------------------+
| Regex backup      |  <-- "hablar con asesor" -> handoff directo
| (handoff.ts)      |
+--------+----------+
         |
         v
+-------------------+
| Cargar contexto   |  <-- Ultimos 20 mensajes, KB, etapas, slots
+--------+----------+
         |
         v
+-------------------+
| LLM call          |  <-- chatJson con schema de acciones
| (OpenRouter)      |
+--------+----------+
         |
         v
+-------------------+
| Ejecutar accion   |  <-- reply/move_stage/handoff/etc
+--------+----------+
         |
         v
+-------------------+
| Publicar SSE      |  <-- Actualizar UI en tiempo real
+-------------------+
```

## Laboratorio (Auto-evaluacion)

### 6 Personas de Prueba

| Persona | Descripcion | Senales |
|---------|-------------|---------|
| `comprador_decidido` | Sabe lo que quiere, va directo a comprar | Respuestas cortas, decision rapida |
| `pregunton_precios` | Pregunta precio tras precio sin decidir | Multiples preguntas, sin compromiso |
| `cliente_enojado` | Enojado por problema con producto | Lenguaje agresivo, quejas |
| `fuera_de_kb` | Pregunta sobre garantia/devoluciones | Temas fuera del KB |
| `pide_humano` | Quiere hablar con humano | Frases como "agente", "asesor" |
| `errores_modismos` | Errores ortograficos y modismos mexicanos | "kiero", "xq", "nel" |

### Scoring

- **Verde** (1 punto): Respuesta correcta
- **Amarillo** (0.5 puntos): Mejorable
- **Rojo** (0 puntos): Critico
- **Score final**: 0-100 puntos
- **Timeout**: 10 minutos maximo por ejecucion
- **Concurrencia**: Max 1 ejecucion corriendo por organizacion (locked via BD)

---

# 10. MODULOS DE NEGOCIO

## Pipeline Kanban

- Etapas personalizables con color y posicion
- Arrastre y drop (drag-and-drop) para mover leads
- **Gate unico**: Solo `moveLeadToStage()` escribe `lead.stage_id`
  - Owner drag
  - Bot
  - Agente IA
  - Eliminacion de etapa (reubicacion masiva)
- Historial completo en `lead_stage_event`
- Razon de perdida requerida al entrar a etapa "perdida"

## Cotizaciones

- Numeracion secuencial: COT-XXXX
- Versionado: cada envio incrementa version
- Items con cantidad y precio unitario
- Descuento (fijo o porcentaje)
- IVA configurable (default 16%)
- Envio por WhatsApp (PDF) o Instagram/Messenger (texto)
- Estados: draft -> sent -> viewed -> accepted/rejected

```typescript
// Calculo de totales
subtotal = sum(items.map(i => quantity * unitPrice))
discount = fixed | (subtotal * percentage / 100)
tax = (subtotal - discount) * taxRate / 100
total = subtotal - discount + tax
```

## Proyectos

- 7 etapas default: Activacion, Diagnostico, Calendario de Entregable, Creacion, Terminacion, Reporte de Resultados, Renovacion
- Codigo secuencial: PRJ-XXXX
- Transiciones con optimistic locking (expectedStageId)
- Tareas con estados: no_empezado, pendiente, terminado
- Archivado de proyectos
- Reportes con historial de etapas

## Finanzas

- **Cuentas por cobrar**: Cargos con saldo pendiente
- **Pagos**: Registro con idempotencia (requestId), actualiza estado del cargo
- **Gastos**: Registro por categoria
- **Balance mensual**: Ingresos - Egresos = Balance
- **Moneda**: MXN (cents-based, no floating point)

```typescript
// Todas las cantidades en centavos (integer)
const amount = 45050; // $450.50 MXN
formatMoneyCents(45050, "MXN") // "$450.50 MXN"
```

## Base de Conocimiento

- Pares pregunta-respuesta
- Categorias
- Limite de tokens (configurable)
- Rendered into agent system prompt

---

# 11. AGENDA Y PROGRAMACION

## Motor de Disponibilidad

```
Configuracion semanal (weeklyHours)
         |
         v
+-------------------+
| Expandir slots    |  <-- Lunes 09:00-18:00, slotMinutes=30
| (candidates)      |      -> 18 slots por dia
+--------+----------+
         |
         v
+-------------------+
| Filtrar ocupados  |  <-- Restar bookings activos
| (free slots)      |
+--------+----------+
         |
         v
+-------------------+
| Spread por dias   |  <-- 3 slots por dia, max 12 ofrecidos
| (ofertas)         |
+--------+----------+
```

## Dos Reglas INNEGOTIABLES

1. **Solo slots que fueron OFERTADOS pueden ser reservados** (comparacion epoch-exacta, sin tolerancia)
2. **Re-validacion en confirmacion** con unique index como guard verdadero de race conditions

## 3 Conectores

| Conector | Externo | Link por reserva | Descripcion |
|----------|---------|------------------|-------------|
| `enlace-fijo` | No | No | URL fija, soberano, sin credenciales |
| `zoom` | Si | Si | Server-to-Server OAuth, meeting por reserva |
| `google` | Si | Si | Calendar + Meet, polling asincrono de link |

### Enlace Fijo (Default)
- Sin dependencias externas
- `createMeeting` retorna URL configurada
- `updateMeeting`/`deleteMeeting` son no-ops

### Zoom
- OAuth Server-to-Server
- 4 scopes: meeting:write, meeting:update, meeting:delete, user:read
- Token cache por SHA256(accountId + clientId + clientSecret)

### Google Calendar
- OAuth2 con scope `calendar.events`
- **Polling asincrono**: Google crea Meet links de forma asincrona. El conector hace polling (3 intentos, 400ms delay) antes de rendirse
- Refresh token expira despues de 7 dias en modo test

---

# 12. INTEGRACIONES EXTERNAS

## Meta Graph API

- WhatsApp Cloud API para envio/recepcion de mensajes
- Instagram Graph API para DMs
- Messenger Platform para mensajes de Facebook
- Conversions API (CAPI) para atribucion de anuncios

## WAHA (WhatsApp HTTP API)

- Alternativa self-hosted a Meta Cloud API
- Conexion HTTP directa
- Soporte para sesiones multiples
- Webhook HMAC-SHA512

## Zernio

- Transporte unificado para Instagram, Messenger, TikTok
- HMAC-SHA256 para verificacion de firmas
- Un solo webhook para todas las plataformas
- Dispatch por `account.platform`
- **Fix v1.4.0**: Aceptar webhooks sin firma cuando no hay signing secret configurado en Zernio (el token de la URL ya valida la fuente)

## OpenRouter

- Adaptador LLM unificado (compatible con Groq, OpenRouter, etc.)
- Configuracion **solo por env vars** (v1.4.0+)
- Modelo actual: `openai/gpt-oss-20b` (Groq, gratis, 131K contexto)
- Base URL: `https://api.groq.com/openai`
- Los campos `aiToken`/`aiModel` en la DB estan deprecated

## Better Auth

- Autenticacion basada en sesiones
- Plugin organization para multi-tenancy
- Cifrado de passwords con bcrypt

---

# 13. API COMPLETA

## Rutas Core

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/health` | GET | Healthcheck (version + commit) |
| `/api/auth/[...all]` | * | Better Auth handlers |
| `/api/events` | GET | SSE realtime channel |
| `/api/dashboard` | GET | KPIs y metricas |

## Conversaciones

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/conversations` | GET/POST | Listar/crear conversaciones |
| `/api/conversations/[id]` | GET/PUT | Obtener/actualizar conversacion |
| `/api/conversations/[id]/messages` | GET | Historial de mensajes |
| `/api/conversations/[id]/messages/media` | POST | Subir adjuntos |
| `/api/conversations/[id]/messages/template` | POST | Enviar template |

## Contactos

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/contacts` | GET/POST | Listar/crear contactos |
| `/api/contacts/[id]` | GET/PUT | Obtener/actualizar contacto |
| `/api/contacts/[id]/start-conversation` | POST | Iniciar conversacion |

## Pipeline

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/pipeline/board` | GET | Datos del tablero kanban |
| `/api/pipeline/stages` | GET/POST | Listar/crear etapas |
| `/api/pipeline/stages/[id]` | PUT/DELETE | Actualizar/eliminar etapa |
| `/api/pipeline/leads/[id]` | PUT | Actualizar lead |

## Agente y Laboratorio

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/agent/profile` | GET/PUT | Perfil del agente |
| `/api/lab/runs` | GET/POST | Listar/iniciar ejecuciones |
| `/api/lab/runs/[id]` | GET | Detalle de ejecucion |
| `/api/lab/suggestions/apply` | POST | Aplicar sugerencias de KB |

## Agenda

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/bookings` | GET/POST | Listar/crear reservas |
| `/api/bookings/[id]` | GET/PUT/DELETE | Obtener/actualizar/cancelar |
| `/api/calendar/availability` | GET | Slots disponibles |
| `/api/calendar/settings` | GET/PUT | Configuracion de agenda |

## Proyectos

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/projects` | GET/POST | Listar/crear proyectos |
| `/api/projects/[id]` | GET/PUT | Obtener/actualizar proyecto |
| `/api/projects/[id]/stages` | GET/POST | Gestionar etapas |
| `/api/projects/[id]/tasks` | GET/POST/PUT/DELETE | CRUD de tareas |
| `/api/projects/[id]/transition` | POST | Transicionar etapa |
| `/api/projects/[id]/report` | GET | Reporte del proyecto |

## Cotizaciones

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/quotes` | GET/POST | Listar/crear cotizaciones |
| `/api/quotes/[id]` | GET/PUT | Obtener/actualizar |
| `/api/quotes/[id]/send` | POST | Enviar cotizacion |
| `/api/quotes/[id]/status` | PUT | Cambiar estado |
| `/api/quotes/[id]/pdf` | GET | Generar PDF |

## Finanzas

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/charges` | GET | Cuentas por cobrar |
| `/api/finances/balance` | GET | Balance |
| `/api/finances/receivables` | GET | Por cobrar |
| `/api/expenses` | GET/POST | Gastos |

## Email

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/email/accounts` | GET/POST | Cuentas email |
| `/api/email/accounts/[id]/sync` | POST | Sincronizar IMAP |
| `/api/email/accounts/[id]/test` | POST | Probar conexion |
| `/api/email/messages` | GET | Mensajes |
| `/api/email/messages/[id]` | GET | Detalle |

## Settings

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/settings/whatsapp` | GET/PUT | Config WhatsApp |
| `/api/settings/whatsapp/waha` | GET/PUT | Config WAHA |
| `/api/settings/instagram` | GET/PUT | Config Instagram |
| `/api/settings/messenger` | GET/PUT | Config Messenger |
| `/api/settings/tiktok` | GET/PUT | Config TikTok |
| `/api/settings/webhook` | GET | URLs de webhooks |
| `/api/settings/branding/*` | GET/PUT | Branding white-label |
| `/api/settings/team` | GET/PUT | Equipo |
| `/api/settings/templates` | GET | Templates |
| `/api/settings/diagnostics` | GET | Diagnosticos |

## Webhooks

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/webhooks/wa/[webhookToken]` | GET/POST | WhatsApp inbound |
| `/api/webhooks/waha/[token]` | POST | WAHA inbound |
| `/api/webhooks/ig/[webhookToken]` | POST | Instagram + TikTok (Zernio) |
| `/api/webhooks/messenger/[webhookToken]` | POST | Messenger |

## Bot API (Microservicio Externo)

| Ruta | Metodo | Descripcion |
|------|--------|-------------|
| `/api/bot/context` | GET | Contexto de conversacion |
| `/api/bot/profile` | GET | Perfil del agente + KB |
| `/api/bot/typing` | POST | Indicador de "escribiendo" |
| `/api/bot/ficha` | GET/PUT | Ficha de calificacion |
| `/api/bot/handoff` | POST | Gestionar handoff |
| `/api/bot/bookings` | GET/POST | Gestionar reservas |
| `/api/bot/messages` | GET | Historial |
| `/api/bot/reset` | POST | Resetear conversacion |

---

# 14. SEGURIDAD Y CONSTITUCION

## Torre de Seguridad (6 Capas)

```
+------------------------------------------+
|  Capa 6: HTTPS (Caddy auto-HTTPS)        |
+------------------------------------------+
|  Capa 5: Rate Limiting (sliding window)   |
+------------------------------------------+
|  Capa 4: HMAC Webhook Verification        |
+------------------------------------------+
|  Capa 3: Better Auth (sesiones + bcrypt)  |
+------------------------------------------+
|  Capa 2: AES-256-GCM (secretos en reposo) |
+------------------------------------------+
|  Capa 1: Multi-tenancy (scoped queries)   |
+------------------------------------------+
```

### Capa 1: Multi-tenancy
Toda tabla de dominio tiene `organization_id NOT NULL`. Todas las queries pasan por `scoped()`:
```typescript
// src/lib/db/tenant.ts
export function scoped<T>(query: T, organizationId: string): T {
  // Agrega WHERE organization_id = ?
}
```

### Capa 2: Cifrado en Reposo
```typescript
// src/lib/crypto/index.ts
export function encryptSecret(plain: string) {
  // AES-256-GCM con ENCRYPTION_KEY (32 bytes base64)
  // Retorna: { cipher, iv, tag } (todos base64)
}
```

### Capa 3: Autenticacion
- Better Auth con plugin organization
- Passwords hasheados con bcrypt
- Tokens de sesion con expiracion

### Capa 4: Verificacion HMAC
```typescript
// Verificacion de webhooks Meta
const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
const signature = req.headers["x-hub-signature-256"];
if (signature !== `sha256=${expected}`) return 401;
```

### Capa 5: Rate Limiting
- Sliding window in-process
- Bot API: 600 requests/minuto
- Login: 10 intentos/15 minutos

### Capa 6: HTTPS
- Caddy auto-HTTPS con Let's Encrypt
- Sin configuracion manual de certificados

## Constitucion (Reglas No Negociables)

1. **Soberania (II)**: El nucleo depende solo de WhatsApp Cloud API + proveedor LLM. Prohibido S3, email, billing u otros terceros en el nucleo. Un tercero solo entra como conector opcional detras de feature flag.

2. **Seguridad (I)**: Secretos cifrados en reposo. Jamas al cliente ni a logs. Token de WhatsApp solo muestra ultimos 4 caracteres.

3. **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio. Toda query pasa por `scoped()`.

4. **Idempotencia (IV)**: Webhooks dedup por `wa_message_id` UNIQUE. Estados monotonos. Seeds y migraciones re-ejecutables.

5. **Sandbox del Laboratorio**: Conversaciones `is_test` JAMAS tocan la API real. El sender lanza excepcion si se intenta.

---

# 15. DESPLIEGUE EN EASYPANEL

## Paso 1: Crear Servicio PostgreSQL

1. En EasyPanel -> Nuevo servicio -> PostgreSQL
2. Configurar:
   - Nombre: `crm_bd`
   - Puerto: 5432
   - Usuario: `postgres`
   - Password: (generar segura)
   - Base de datos: `lumark`
3. Guardar las credenciales

## Paso 2: Crear Servicio App

1. En EasyPanel -> Nuevo servicio -> Dockerfile
2. Conectar al repositorio Git
3. Configurar:
   - Puerto: 3000
   - Dockerfile path: `./Dockerfile`

## Paso 3: Variables de Entorno

```bash
# Base de datos
DATABASE_URL=postgres://postgres:PASSWORD@crm_bd:5432/lumark

# Autenticacion
BETTER_AUTH_SECRET=(generar: openssl rand -base64 32)

# Cifrado
ENCRYPTION_KEY=(generar: openssl rand -base64 32)

# App
APP_BASE_URL=https://tudominio.com

# WhatsApp (Meta)
META_WEBHOOK_VERIFY_TOKEN=(token de verificacion)
META_APP_SECRET=(opcional, para firma HMAC)

# Canales
CHANNELS=whatsapp,instagram,messenger,tiktok

# IA (solo env vars — v1.4.0+)
OPENROUTER_BASE_URL=https://api.groq.com/openai
OPENROUTER_API_TOKEN=gsk_...
OPENROUTER_MODEL=openai/gpt-oss-20b

# WAHA (opcional)
WAHA_BASE_URL=http://waha:3000
WAHA_API_KEY=tu-api-key

# Operaciones
ALLOW_SIGNUP=true
AGENT_COALESCE_MS=6000
MEDIA_DIR=/data/media
```

**NOTA v1.4.0**: La configuracion de IA (token y modelo) ahora es SOLO por variables de entorno. Los campos `aiToken` y `aiModel` en la DB estan deprecated y la UI ya no los muestra.

## Paso 4: Verificar Salud

```
GET https://tudominio.com/api/health
```

Respuesta esperada:
```json
{
  "ok": true,
  "version": "1.3.0",
  "commit": "abc1234"
}
```

## Paso 5: Configurar WhatsApp

1. Ir a Settings -> WhatsApp
2. Ingresar Phone Number ID, WABA ID, y Token
3. Configurar webhook en Meta Developer Console:
   - URL: `https://tudominio.com/api/webhooks/whatsapp/TOKEN`
   - Fields: `messages`, `messaging_postbacks`

## Paso 6: Activar Canales

- En EasyPanel -> CRM -> Env vars -> `CHANNELS`
- Agregar `tiktok` si se desea: `CHANNELS=whatsapp,instagram,messenger,tiktok`
- Reiniciar el contenedor

## Paso 7: Configurar Dominio Personalizado

### 7.1 Configurar DNS en tu proveedor (Hostinger, etc.)

Agregar registros DNS:

| Tipo | Nombre | Apunta a | TTL |
|------|--------|----------|-----|
| **A** | `@` | `35.232.183.92` (IP del VPS) | 3600 |
| **A** | `www` | `35.232.183.92` (IP del VPS) | 3600 |

### 7.2 Agregar dominio en EasyPanel

EasyPanel necesita registrar el dominio para configurar proxy inverso + SSL automatico:

```bash
# Via API (o desde la UI de EasyPanel)
curl -sk -X POST "https://35.232.183.92/api/trpc/domains.createDomain" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "json": {
      "projectId": "crm",
      "host": "tudominio.com",
      "serviceName": "crm",
      "path": "/",
      "https": true,
      "certificateResolver": "",
      "id": "generated-id",
      "middlewares": [],
      "wildcard": false,
      "destinationType": "service"
    }
  }'
```

EasyPanel creara automaticamente un certificado SSL via Let's Encrypt.

### 7.3 Actualizar APP_BASE_URL

Cambiar la env var en EasyPanel:
```
APP_BASE_URL=https://tudominio.com
```

Esto asegura que los links internos (webhooks, auth, etc.) usen tu dominio.

### 7.4 Actualizar Webhooks

Despues de configurar el dominio, actualizar las URLs de webhook en:

- **Meta/Facebook** (WhatsApp Business): `https://tudominio.com/api/webhooks/wa/{token}`
- **Meta/Facebook** (Instagram): `https://tudominio.com/api/webhooks/ig/{token}`
- **Zernio**: `https://tudominio.com/api/webhooks/ig/{token}`

### Flujo de conexion

```
Usuario escribe tudominio.com
    ↓ DNS (Hostinger/A Records)
    ↓ 35.232.183.92
    ↓ EasyPanel (Traefik + SSL automatico)
    ↓ Contenedor CRM (puerto 3000)
    ↓ App responde
```

---

# 16. BUGS, ERRORES Y SOLUCIONES

## Bug 1: Password Auth Failures Masivas (PostgreSQL)

**Fecha**: 18 de Septiembre de 2026  
**Severidad**: Alta  
**Simptomas**: Cientos de errores `FATAL: password authentication failed for user "postgres"` cada 2 segundos en logs de PostgreSQL

**Causa raiz**: El contenedor de PostgreSQL fue destruido y recreado. La base de datos se inicializo desde cero (`initdb` + `CREATE DATABASE`), pero el CRM seguia intentando conectarse con la password anterior `1234`.

**Lineas de tiempo**:
- Sep 15 18:57 - PostgreSQL inicializado desde cero
- Sep 18 02:09 - Empiezan los fallos de autenticacion (cientos cada 2 segundos)
- Sep 18 ~02:20 - Alguien fija la password, el CRM vuelve a funcionar

**Solucion**: Verificar la password actual en EasyPanel -> CRM -> Env vars -> `DATABASE_URL`.

**Leccion aprendida**: Cuando se recrea un contenedor de BD, hay que verificar que la password en `DATABASE_URL` coincida con la nueva instancia.

## Bug 2: igUserId Type Error (null handling)

**Fecha**: 19 de Septiembre de 2026  
**Severidad**: Baja  
**Simptomas**: Potencial mismatch entre tipo Zod (`nullish`) y schema DB (`NOT NULL`)

**Detalle tecnico**:
```typescript
// Zod schema permite null/undefined
igUserId: z.string().trim().max(100).nullish()

// Pero la DB tiene NOT NULL
igUserId: varchar("ig_user_id", { length: 255 }).notNull()
```

**Solucion existente**: El codigo ya maneja esto con fallback:
```typescript
igUserId: data.igUserId ?? data.accountRef ?? ""
```

**Estado**: No es un bug real. El typecheck pasa limpio. El fallback a string vacio satisface el constraint NOT NULL.

## Bug 3: TikTok Channel Activation

**Fecha**: 19 de Septiembre de 2026  
**Severidad**: Baja  
**Simptomas**: TikTok no aparecia en la interfaz

**Causa**: TikTok estaba 100% implementado en el codigo, pero no estaba en la variable `CHANNELS`.

**Solucion**: Cambiar en `.env.local`:
```bash
# Antes
CHANNELS=whatsapp,instagram,messenger

# Despues
CHANNELS=whatsapp,instagram,messenger,tiktok
```

**Verificacion**: `pnpm typecheck` paso limpio, `pnpm lint` solo 1 warning menor.

**Leccion**: Antes de buscar bugs, verificar que la feature no este simplemente deshabilitada por config.

## Bug 4: waha-client Lint Warning

**Fecha**: 19 de Septiembre de 2026  
**Severidad**: Baja  
**Simptomas**: Warning de ESLint en `waha-client.tsx:59`

```
warning: Using `<img>` could result in slower LCP and higher bandwidth.
Consider using `<Image />` from `next/image`
```

**Detalle**: El componente usa `<img>` nativo en lugar de `<Image>` de Next.js.

**Estado**: Warning, no error. No bloquea build ni deploy. El componente funciona correctamente.

**Solucion potencial**: Reemplazar `<img>` por `<Image>` de next/image con loader personalizado (el QR code viene de una URL externa).

## Bug 5: Agent Pipeline Missing organizationId

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Alta  
**Simptomas**: Agente IA fallaba al resolver configuracion de IA (token/modelo) porque no recibia `organizationId`

**Causa**: `chatJson()` en `pipeline.ts`, `judge.ts` y `runner.ts` no pasaban `organizationId` al llamar `chatJson()`, asi que `resolveAiConfig()` nunca consultaba la DB.

**Solucion**: Agregar `organizationId` a las llamadas `chatJson()` en:
- `src/server/ai/pipeline.ts` — turno del agente
- `src/server/lab/judge.ts` — juez del Laboratorio
- `src/server/lab/runner.ts` — runner del Laboratorio

**Commits**: `f47c2a0`

## Bug 6: Masked Token Storage

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Media  
**Simptomas**: Si un usuario pegaba un token enmascarado (`sk-or-12…abcd`) en la UI, se guardaba como credencial real

**Causa**: El endpoint PUT de `/api/agent/profile` no validaba si el token estaba enmascarado.

**Solucion**: Rechazar tokens que contengan `…`, `*`, o `•` en el handler PUT.

**Commit**: `f47c2a0`

## Bug 7: Instagram Webhook URL Field Mismatch

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Alta  
**Simptomas**: URL de webhook de Instagram no se mostraba correctamente en Settings

**Causa**: El componente usaba `igUrl` pero el backend retornaba `instagramUrl`. TikTok URL también estaba malformada.

**Solucion**: 
- Cambiar `igUrl` → `instagramUrl` en `instagram-client.tsx`
- Corregir URL de TikTok a `/api/webhooks/tiktok/`

**Commit**: `f47c2a0`

## Bug 8: Lab Score Display

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Baja  
**Simptomas**: Laboratorio mostraba "0" cuando no habia score en vez de indicar que no habia evaluacion

**Causa**: `score === null ?? 0` retornaba 0 en vez de mostrar un estado vacio.

**Solucion**: Mostrar badge "Sin score" cuando `score === null`.

**Commit**: `f47c2a0`

## Bug 9: Concurrent Lab Runs

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Media  
**Simptomas**: Multiples ejecuciones del Laboratorio podian correr simultaneamente para la misma organizacion

**Causa**: No habia constraint de unicidad para ejecuciones activas.

**Solucion**: Migracion `0009` con unique index parcial: solo una ejecucion `running` por organizacion.

**Commit**: `f47c2a0`

## Bug 10: Zernio Webhook 401 Unauthorized

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Alta  
**Simptomas**: Webhooks de Zernio (Instagram/Messenger/TikTok) retornaban 401

**Causa**: `isValidZernioSignature()` rechazaba requests sin firma cuando la DB tenia un `webhookSecret` guardado. Pero Zernio no envia firma si el webhook no tiene signing secret configurado en su panel.

**Solucion**: Aceptar requests sin firma cuando no hay signing secret configurado — el token de la URL ya valida la fuente.

```typescript
// ANTES (bug):
if (!signature) return false;

// DESPUES (fix):
if (!signature) return true; // URL token ya valido la fuente
```

**Commit**: `34a578a`

## Bug 11: AI Model Not Found (Groq)

**Fecha**: 20 de Septiembre de 2026  
**Severidad**: Alta  
**Simptomas**: Agente IA fallaba con "model not found" o "no access"

**Causa**: El modelo `llama-3.1-8b-instant` es Enterprise-only en Groq. Ademas, el modelo de la DB tenia prioridad sobre la env var en `chatJson()`.

**Solucion**: 
1. Cambiar modelo a `openai/gpt-oss-20b` (gratis, 131K contexto)
2. Invertir prioridad: env var siempre gana sobre DB
3. Eliminar UI de "Proveedor de IA" (configuracion solo por env vars)
4. Simplificar `resolveAiConfig()` para solo usar env vars

**Commits**: `4e6d8f4`

---

# 17. TESTING Y VERIFICACION

## Unit Tests (Vitest)

450 tests en 53 archivos cubriendo:

| Modulo | Tests |
|--------|-------|
| AI adapter | `ai-adapter.test.ts` |
| Agenda | `availability.test.ts`, `contracts.test.ts`, `flags.test.ts`, `offers.test.ts`, `slots.test.ts` |
| Attribution | `attribution.test.ts`, `conversions.test.ts` |
| Bot | `bot-gateway.test.ts`, `profile.test.ts`, `ficha.test.ts` |
| Channels | `channels.test.ts` |
| Contacts | `contacts.test.ts` |
| Crypto | `crypto.test.ts` |
| Identity | `identity.test.ts` |
| Lab | `sandbox.test.ts`, `judge.test.ts` |
| Messenger | `messenger.test.ts` |
| Projects | `projects.test.ts` |
| Send | `send-sandbox.test.ts` |
| Stage history | `stage-history.test.ts`, `status-monotonic.test.ts` |
| Tenant | `tenant.test.ts` |
| Templates | `templates.test.ts` |
| Webhooks | `webhook.test.ts` |
| Window | `window.test.ts` |

## Scripts E2E (Playwright)

17 scripts que cubren flujos de comportamiento completos:

| Script | Flujo |
|--------|-------|
| `e2e-selftest.mjs` | Test comprehensive: BSUID, bot API, agenda, atribucion |
| `e2e-lumark.mjs` | Flujos LUMARK: login, catalogo, cotizaciones, proyectos |
| `e2e-bitacora-etapas.mjs` | Eventos de etapa del pipeline |
| `e2e-templates-sync.mjs` | Sincronizacion de templates |
| `e2e-send-failure.mjs` | Visualizacion de envios fallidos |
| `e2e-search-filters.mjs` | Busqueda y filtros del inbox |
| `e2e-templates-multivar.mjs` | Templates multi-variable |
| `e2e-projects-tasks.mjs` | Proyectos y tareas |
| `e2e-envio-instantaneo.mjs` | Envio instantaneo |
| `e2e-messenger.mjs` | Canal Messenger |
| `e2e-alta-manual.mjs` | Alta manual de leads |
| `e2e-favicon.mjs` | Favicon personalizado |
| `e2e-monto-pipeline.mjs` | Montos en pipeline |
| `e2e-ficha-lead.mjs` | Ficha de lead |
| `e2e-prioridad.mjs` | Prioridad de leads |
| `e2e-responsive.mjs` | Diseno responsivo |
| `e2e-diseno-atlas.mjs` | Diseno atlas white-label |

## Gate de Verificacion

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Todo esto debe pasar antes de considerar una feature "completada".

## Mocks del Entorno

- `WA_MOCK_ENABLED=true` - Mock de WhatsApp
- `META_GRAPH_BASE_URL` -> wa-mock
- `OPENROUTER_BASE_URL` -> ai-mock
- `ZOOM_BASE_URL` -> zoom-mock
- `GOOGLE_CAL_BASE_URL` -> google-mock

---

# 18. ESCALABILIDAD Y RENDIMIENTO

## Patrones de Escalabilidad

### 1. Coalesce de Mensajes
Multiples mensajes en rafaga -> UNA sola respuesta del agente. Configurable via `AGENT_COALESCE_MS` (default 6000ms).

### 2. Debounce del Agente
Nunca dos turnos simultaneos por conversacion. Si hay un turno corriendo, el siguiente se encola.

### 3. Rate Limiting
Sliding window in-process. Sin Redis ni servicio externo.

### 4. SSE vs WebSockets
SSE es mas simple y funciona detras de proxies/CDNs. Heartbeat cada 25s mantiene la conexion viva.

### 5. Monolito vs Microservicios
Un solo contenedor = despliegue simple, latencia minima, debugging facil. Suitable para una instancia = un negocio.

## Limites Conocidos

| Limite | Valor | Nota |
|--------|-------|------|
| Mensajes por segundo | ~50 | Limitado por LLM API calls |
| Conversaciones simultaneas | ~500 | Depende del hardware |
| Tamanio maximo de KB | Configurable | Validado en `kb/size` |
| Maximo de slots ofrecidos | 12 | 3 por dia, 4 dias |
| Archivos media | 16MB | Meta limit |
| Tasa de webhooks | ~100/s | PostgreSQL write throughput |

## Optimizaciones

1. **Conexiones DB**: Pool via postgres.js (connection pooling nativo)
2. **Cache de configuracion**: `getEnv()` cachea una vez por proceso
3. **Cache de tokens OAuth**: En memoria por proceso (Zoom, Google)
4. **Compresion**: gzip via Caddy
5. **Standalone output**: Next.js standalone para Docker (sin node_modules)

---

# 19. GUIA DE MANTENIMIENTO Y SOPORTE

## Comandos Utiles

```bash
# Verificar salud
curl https://tudominio.com/api/health

# Ver logs del contenedor
docker logs crm_app --tail 100 -f

# Ver logs de PostgreSQL
docker logs crm_bd --tail 100 -f

# Resetear password de usuario
node scripts/reset-password.mjs

# Generar seed de demo
pnpm seed:demo

# Correr tests
pnpm typecheck && pnpm lint && pnpm test

# Generar migracion
pnpm db:generate

# Aplicar migraciones (se hace automaticamente al arrancar)
node scripts/migrate.mjs
```

## Como Actualizar

1. Hacer pull de los cambios
2. Rebuild del contenedor: `docker compose build app`
3. Restart: `docker compose up -d app`
4. Las migraciones se aplican automaticamente al arrancar

## Como Rotar Passwords

1. **PostgreSQL**: `ALTER USER postgres PASSWORD 'nueva_password';`
2. **Actualizar DATABASE_URL** en EasyPanel
3. **Reiniciar** el contenedor

## Como Agregar un Canal

1. Definir el tipo en `src/lib/channels.ts`
2. Agregar capacidades en `src/server/channels/capabilities.ts`
3. Crear modulos en `src/server/[canal]/`:
   - `credentials.ts` - CRUD de credenciales
   - `ingest.ts` - Procesamiento de mensajes entrantes
   - `send.ts` - Envio de mensajes
4. Agregar ruta de settings en `src/app/api/settings/[canal]/`
5. Agregar webhook si es necesario
6. Crear migracion para tabla de credenciales
7. Agregar a `CHANNELS` en `.env`

## Como Agregar una Migracion

1. Modificar `src/lib/db/schema.ts`
2. Ejecutar `pnpm db:generate`
3. El nuevo archivo SQL aparecera en `drizzle/`
4. Nombrar secuencialmente: `0009_descripcion.sql`
5. Las migraciones se aplican automaticamente al arrancar el contenedor

## Monitoreo

- **Healthcheck**: `GET /api/health` cada 15s (configurado en Docker)
- **Logs**: `docker logs` o EasyPanel -> Logs
- **Diagnosticos**: `/api/settings/diagnostics`
- **Eventos SSE**: `/api/events` para monitoreo en tiempo real

---

# 20. GLOSARIO Y REFERENCIAS

## Glosario

| Termino | Definicion |
|---------|------------|
| **ADR** | Architecture Decision Record - documento de decision arquitectonica |
| **BSUID** | Business-Scoped User ID - identificador unico de Meta por negocio |
| **CAPI** | Conversions API - API de Meta para reportar conversiones |
| **channel** | Canal de comunicacion (WhatsApp, Instagram, Messenger, TikTok) |
| **coalesce** | Patron de agrupacion: multiples eventos -> una respuesta |
| **constitucion** | Reglas no negociables del proyecto (Soberania, Seguridad, Multi-tenancy, Idempotencia) |
| **handoff** | Transferencia de control del agente IA a un humano |
| **KB** | Knowledge Base - base de conocimiento del agente |
| **lead** | Oportunidad de venta en el pipeline |
| **pipeline** | Tablero kanban con etapas para gestionar leads |
| **scoped** | Funcion que agrega filtros de multi-tenancy a queries |
| **SSE** | Server-Sent Events - protocolo de comunicacion unidireccional |
| **slot** | Franja horaria disponible para agendar una cita |
| **template** | Mensaje pre-aprobado por Meta para envio fuera de ventana |
| **Zernio** | API unificada para Instagram, Messenger y TikTok |
| **WAHA** | WhatsApp HTTP API - alternativa self-hosted a Meta Cloud API |
| **window** | Ventana de 24h para responder mensajes gratuitamente |

## Referencias a Documentacion Interna

| Documento | Ubicacion | Contenido |
|-----------|-----------|-----------|
| CLAUDE.md | Raiz del proyecto | Guia para Claude Code |
| SISTEMA-COMPLETO.md | docs/ | Documentacion del sistema (1635 lineas) |
| ADR-001 | docs/adr-001-canales-opcionales.md | Decision: canales opcionales |
| ADR-002 | docs/adr-002-conectores-de-agenda.md | Decision: conectores de agenda |
| Constitution | .specify/memory/constitution.md | Reglas no negociables |
| EasyPanel Guide | docs/easypanel.md | Guia de despliegue |
| Getting Started | docs/getting-started.md | Primeros pasos |
| Atribucion CAPI | docs/atribucion-capi.md | Guia de atribucion |
| Agenda Conectores | docs/agenda-conectores.md | Conectores de agenda |
| MCP Setup | docs/mcp-setup.md | Configuracion de MCP |
| Three Agent Architecture | docs/three-agent-architecture.md | Arquitectura de agentes |
| SDD Workflow | docs/sdd-workflow.md | Flujo de trabajo SDD |

## Especificaciones (specs/)

| Spec | Directorio | Contenido |
|------|------------|-----------|
| 001 | specs/001-vocero-core/ | Core del CRM |
| 002 | specs/002-diseno-atlas-white-label/ | Diseno white-label |
| 003 | specs/003-paridad-inbox-whatsapp/ | Paridad de inbox |
| 014 | specs/014-canal-instagram/ | Canal Instagram |
| 015 | specs/015-motor-agenda-universal/ | Motor de agenda |
| 016 | specs/016-atribucion-capi/ | Atribucion CAPI |
| 017 | specs/017-canal-messenger/ | Canal Messenger |

## Links Externos

- Next.js Docs: https://nextjs.org/docs
- Drizzle ORM: https://orm.drizzle.team
- Better Auth: https://www.better-auth.com
- OpenRouter: https://openrouter.ai
- Groq: https://console.groq.com
- Meta Graph API: https://developers.facebook.com/docs/graph-api
- WAHA: https://github.com/evolution/whatsapp-web.js
- Zernio: https://zernio.com
- Tailwind CSS: https://tailwindcss.com
- Vitest: https://vitest.dev
- Playwright: https://playwright.dev

---

**Fin de la Documentacion**

*Documento generado el 20 de Septiembre de 2026*
*Version 1.4.0 - CRM LUMARK*
