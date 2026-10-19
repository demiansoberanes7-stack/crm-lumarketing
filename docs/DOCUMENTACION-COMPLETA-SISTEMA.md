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
15. [Despliegue en produccion (VM + Docker Compose)](#15-despliegue-en-produccion-vm--docker-compose)
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

Contado sobre el repo el 19 de octubre de 2026 (`find`/`grep`/`vitest`, no estimado):

| Metrica | Valor |
|---------|-------|
| Tablas en `schema.ts` (`pgTable`) | 102 (106 en produccion: 4 las crea una migracion) |
| Entradas del journal de migraciones | 77 |
| Rutas API (`src/app/**/route.ts`) | 202 |
| Componentes UI (`src/components/**/*.tsx`) | 135 |
| Unit tests | 1086 en 124 archivos (`pnpm test`, 15.5 s) |
| Scripts E2E | 21 |
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
|  102 tablas    |  |  (gpt-oss via    |  |  WhatsApp/IG     |
|                |  |   Groq/OpenAI)   |  |                  |
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
| AES-256-GCM | custom (node:crypto) | Cifrado de secretos en reposo |
| `src/server/media-path.ts` | custom | Contencion de rutas de disco (traversal + symlinks) |
| `next.config.ts` `headers()` | custom | Cabeceras de respuesta globales (nosniff, XFO, HSTS…) |
| `checkDistributedRateLimit` | custom (Postgres) | Rate limiting compartido entre replicas sin Redis |

## IA y LLM

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Groq | API | Proveedor de IA (via adaptador OpenRouter-compatible) |
| openai/gpt-oss-120b | default del compose | Modelo del agente (`OPENROUTER_MODEL`, lo pisa el `.env`) |
| openai/gpt-oss-20b | default del compose | Modelo del juez del Laboratorio (`OPENROUTER_JUDGE_MODEL`) |

Separacion real entre token y modelo (`resolveAiConfig()`, `src/lib/ai/index.ts:70-89`): el
**modelo** se define solo en el entorno (`OPENROUTER_MODEL`); el **token** tiene prioridad
inversa — el guardado desde Configuracion (BD, cifrado, agente y copiloto comparten uno solo)
gana y `OPENROUTER_API_TOKEN` queda como respaldo de despliegue. En la instancia actual
`agent_profile.ai_token*` esta vacio, asi que quien manda es la variable de entorno.

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

La imagen **no se compila en el VPS**: se hace `pull` de Docker Hub. El build ocurre en
GitHub Actions (`docker.yml`) al hacer push a `main`.

```yaml
services:
  app:
    # APP_IMAGE permite fijar un digest en el .env del servidor sin editar el compose.
    # Fijar por digest es lo que corta el CD automatico (y la palanca de rollback).
    image: ${APP_IMAGE:-ghostbreakfast69/lumark-crm:latest}
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      - NODE_OPTIONS=--max-old-space-size=384
      - DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/lumark
      # Lista NOMINAL: una variable que no aparece aqui no llega al proceso aunque
      # exista en .env (asi quedo INTEL apagada en una replica del repo).
      - META_APP_SECRET=${META_APP_SECRET:-}
      - INTEL=${INTEL:-}
      - MCP_WRITE_ENABLED=${MCP_WRITE_ENABLED:-false}
      # ... demas variables
    volumes:
      - media_data:/data/media   # Archivos media persistentes (volumen nombrado)
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
    deploy: { resources: { limits: { memory: 512M } } }

  postgres:
    image: postgres:16-alpine
    # Tuning explicito para la VM de 1 GiB
    command: ["postgres", "-c", "shared_buffers=96MB", "-c", "work_mem=2MB",
              "-c", "max_connections=20", "..."]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 10
    volumes:
      - postgres_data:/var/lib/postgresql/data
    deploy: { resources: { limits: { memory: 384M } } }
    # Sin tope de logs a proposito: cambiarlo exige reiniciar la BD

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro   # solo lectura
      - caddy_data:/data
      - caddy_config:/config
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

volumes: [postgres_data, caddy_data, caddy_config, media_data]
```

El puerto 3000 de la app **no se publica**: todo entra por 80/443 a traves de Caddy. Los
tres servicios con tope de logs lo llevan porque `json-file` sin tope llena el disco de la
VM y el sintoma no es "logs viejos", es Postgres o Caddy sin donde escribir.

## Dockerfile (Multi-stage - 4 etapas)

```dockerfile
# Etapa 1: Dependencias
FROM node:22-alpine AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --frozen-lockfile: si package.json y el lockfile discrepan, pnpm resuelve otras
# versiones en silencio y la imagen publicada no es la que se probo en ningun lado.
RUN pnpm install --frozen-lockfile

# Etapa 2: Build
FROM node:22-alpine AS builder
ARG SOURCE_COMMIT=""
ARG GIT_SHA=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT GIT_SHA=$GIT_SHA   # /api/health reporta el commit
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
# Bundles autocontenidos (drizzle-orm y postgres van dentro del JS, no de node_modules)
RUN pnpm exec esbuild scripts/migrate.mjs --bundle --platform=node --format=esm \
    --outfile=migrate.bundle.mjs ...
RUN pnpm exec esbuild scripts/seed/demo.ts --bundle ... --outfile=seed-demo.bundle.mjs

# Etapa 3: Test (Chromium para E2E)
FROM node:22-alpine AS test
RUN apk add --no-cache chromium

# Etapa 4: Runner (produccion)
FROM node:22-alpine AS runner
ENV NODE_ENV=production NODE_OPTIONS="--max-old-space-size=384"
RUN apk add --no-cache fontconfig ttf-dejavu  # sin tipografias, el SVG rasterizado pierde texto
RUN addgroup -S lumark && adduser -S lumark -G lumark
RUN mkdir -p /data/media && chown -R lumark:lumark /data
WORKDIR /app
COPY --from=builder --chown=lumark:lumark /app/.next/standalone ./
COPY --from=builder --chown=lumark:lumark /app/.next/static ./.next/static
COPY --from=builder --chown=lumark:lumark /app/public ./public
COPY --from=builder --chown=lumark:lumark /app/migrate.bundle.mjs ./migrate.mjs
COPY --from=builder --chown=lumark:lumark /app/seed-demo.bundle.mjs ./seed-demo.mjs
COPY --from=builder --chown=lumark:lumark /app/drizzle ./drizzle   # los .sql tienen que ir en la imagen
USER lumark
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
```

`--start-period=40s` cubre las migraciones del arranque. El `CMD` con `&&` es el punto debil
conocido: si `migrate.mjs` aborta (un `.sql` del journal que no esta en la imagen), Next nunca
llega a escuchar y el contenedor entra en crash loop con 502 publico. `next build` **no** ejecuta
`migrate.mjs`, asi que la build puede estar verde y el arranque roto — por eso `pnpm db:guard`
(queues journal ↔ archivos) corre en CI **y** en CD antes de subir nada.

## docker-compose.dev.yml (Desarrollo)

- Proyecto propio (`name: lumark-dev`) para no colisionar con el compose de produccion
- PostgreSQL 16 en puerto **5433**:5432, password `lumark` por defecto
- Redis 7 (6379) y Temporal (`temporalio/auto-setup` 7233) + su UI (8080), para el worker de
  tareas; Temporal queda **apagado por defecto** en la app: `TEMPORAL_ADDRESS` usa
  `localhost:7233` si no se define, y una cadena vacia cambiaria el comportamiento

## docker-compose.local.yml (Full Stack Local)

- App en puerto 3100:3000
- Mocks habilitados: `WA_MOCK_ENABLED=true`
- Meta Graph y OpenRouter apuntan a mocks locales
- PostgreSQL en puerto 5433

## Caddyfile

```
{$DOMAIN} {
    # Un acceso por peticion: sin esto un incidente (scraping, abuso, reenvios al
    # webhook) pasa sin evidencia. La rotacion la pone el compose (10m x 3).
    log

    reverse_proxy app:3000 {
        flush_interval -1  # Critico para SSE
        # El rate limit de la app mira primero x-real-ip y Caddy no la escribe por
        # defecto: sin esta linea la cabecera llega ausente.
        header_up X-Real-IP {http.request.remote.host}
    }
    encode gzip
}
```

- `flush_interval -1` es critico: sin esto, Caddy bufferiza las respuestas SSE y el realtime no funciona.
- `header_up X-Real-IP` es lo que hace fiable el rate limiting por IP (§14, Capa 5).
- Las cabeceras de seguridad **no** se ponen aqui: estan en `next.config.ts` para viajar con la
  imagen y ser reproducibles desde el repo. El proxy solo enruta y registra.
- **Trampa del bind mount**: el volumen monta un *inode*, no una ruta. Editar el `Caddyfile` del
  servidor con `mv nuevo Caddyfile` deja el contenedor leyendo el archivo viejo. Reescribir en el
  sitio (`cat nuevo > Caddyfile`) y aplicar con `caddy reload` dentro del contenedor — recrearlo
  cortaria las conexiones SSE. Validar antes:
  `docker run --rm -v $PWD/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`

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

## Tablas por Dominio (102 en el modelo)

**Deriva de esquema conocida**: la BD de produccion tiene **106** tablas. Las 4 extra
(`diagnostic_event`, `whatsapp_settings`, `integration_secret`, `whatsapp_address`) las crea
`drizzle/0006_diagnostics_messaging.sql`, que **si** esta en el journal, asi que una replica
nueva las recibe igual. El riesgo no es que falten: es que `drizzle-kit generate` no las conoce
y si algun dia se modelan en `schema.ts` el generador emite un `CREATE TABLE` que choca.
`whatsapp_address` ademas no la referencia ningun codigo.

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
| `agent_profile` | Perfil del agente | organizationId, name, tone, instructions, fichaFields, rules, aiTokenCipher/iv/tag (deprecated, usar env vars) |
| `kb_entry` | Base de conocimiento | organizationId, question, answer, category |
| `agent_test_run` | Ejecuciones del Laboratorio | organizationId, status, score |
| `agent_test_case` | Casos de prueba | runId, persona, verdict (verde/amarillo/rojo) |
| `copilot_settings` | Fuentes del Copiloto (IA de consulta, solo lectura) | organizationId, accessMode, dataSources |
| `watsi_message` | Historial del chat del Copiloto | organizationId, role, content, sources |

El **Copiloto** (`/copiloto`) es la superficie de consulta: lee las fuentes que
el owner habilito, siempre acotado al tenant, y no escribe ni envia nada. El
**Agente** (Bandeja) es la superficie comercial: responde, mueve etapas, agenda
y cotiza. Guia: [copiloto-agente.md](copiloto-agente.md).

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
| `integration_secret` | Secretos generales | organizationId, key, valueCipher/iv/tag |
| `verification` | Verificaciones email | identifier, token, expiresAt |
| `invitation` | Invitaciones de equipo | organizationId, email, role, status |

## Migraciones

La cadena completa vive en `drizzle/` (`0000_baseline.sql` en adelante) y se
aplica automaticamente al arrancar el contenedor. El registro obligatorio esta
en `drizzle/meta/_journal.json`.

- La lista canonica es `ls drizzle/*.sql`; este documento no la duplica (una
  tabla congelada aqui quedo obsoleta al poco de existir).
- Cambios de esquema: editar `src/lib/db/schema.ts` → `pnpm db:generate` →
  revisar el SQL → commitear archivo y journal.
- Verificacion: los logs de arranque muestran cada migracion aplicada.

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
| WhatsApp | 24h | none (no se envia) | sin limite | Si | Si |
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

1. **En la VM**: agregar el canal a `CHANNELS` en `~/crm-lumarketing/.env`
2. `docker compose up -d app` (recrea y vuelve a leer `.env`; `restart` no lo hace)
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
Fuera de la ventana: no hay salida (handoff con razon "ventana").

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

**IMPORTANTE (v1.4.0)**: La configuracion de IA ahora es **solo por variables de entorno**. Los campos `aiToken` y `aiModel` en `agent_profile` estan deprecated. La UI ya no muestra la seccion "Proveedor de IA" — todo se configura via env vars en el `.env` de la VM.

```bash
# Configuracion de IA (solo env vars)
OPENROUTER_BASE_URL=https://api.groq.com/openai
OPENROUTER_API_TOKEN=gsk_...
OPENROUTER_MODEL=openai/gpt-oss-120b
OPENROUTER_JUDGE_MODEL=openai/gpt-oss-20b
```

## Pipeline del Agente (9 acciones)

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
| `send_quote` | Enviar la ficha de un producto del catalogo |
| `create_quote` | Crear y enviar una cotizacion formal (idempotente; gate `sendProductQuotes`) |

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

### Editar, desconectar y cambiar la cuenta de Instagram

En **Configuracion → Instagram** (`/settings/instagram`):

1. **Editar conexion de Instagram** permite cambiar el `accountId`, la API key
   y el secreto del webhook con **Probar y guardar**. Se requiere volver a
   introducir la API key; el CRM solo muestra los ultimos cuatro caracteres.
2. **Desconectar Instagram** desvincula la cuenta de la organizacion actual
   y limpia los campos del formulario. Tambien funciona si el token esta vencido.
3. Para conectar otro Instagram ya vinculado en Zernio, introduce su `accountId`,
   la API key y, si corresponde, el secreto del webhook; pulsa **Probar y guardar**.

La desconexion elimina solo las credenciales de Instagram del CRM. Conserva
contactos y conversaciones y no revoca la cuenta en Zernio. Los nuevos eventos
se enrutan por el `account.id` configurado; conservar el historial no transfiere
los hilos anteriores a la nueva cuenta de Instagram.

`DELETE /api/settings/instagram` requiere sesion, respeta la bandera del canal,
limita el borrado a la organizacion autenticada y registra el diagnostico
`disconnected`. Repetirlo sin conexion devuelve igualmente `{ "ok": true }`.
Si el servidor o la red fallan, la interfaz muestra el error y conserva los
datos para reintentar; no anuncia una desconexion exitosa.

Verificacion: `tests/unit/instagram-disconnect.test.ts` cubre aislamiento por
organizacion, autenticacion, canal apagado, repeticion y fallo de BD.
`scripts/e2e-instagram-disconnect.mjs` prueba en Playwright la app real con BD
local y Zernio simulado: conectar A, errores HTTP/red, desconectar con estado
vencido, conectar B, recargar y comprobar que el historial sigue disponible.

```bash
# App local con CHANNELS=whatsapp,instagram, WA_MOCK_ENABLED=true,
# ZERNIO_BASE_URL apuntando a /api/dev/zernio-mock y BD de pruebas migrada.
APP_BASE_URL=http://localhost:3147 META_WEBHOOK_VERIFY_TOKEN=TOKEN_DE_PRUEBAS \
  node scripts/e2e-instagram-disconnect.mjs
```

### Transporte

- Transporte unificado para Instagram, Messenger, TikTok
- HMAC-SHA256 para verificacion de firmas
- Un solo webhook para todas las plataformas
- Dispatch por `account.platform`
- **v1.4.0**: aceptar webhooks sin firma cuando no hay signing secret configurado en Zernio
- **Auditoria 2026-10-19 (A-03)**: con `webhook_secret` guardado en la cuenta, la firma pasa a ser
  **obligatoria** — un evento sin cabecera se rechaza con 401. Ver Bug 10 en §16 para el porque

## OpenRouter

- Adaptador LLM unificado (compatible con Groq, OpenRouter, etc.)
- **Modelo**: solo por env vars (`OPENROUTER_MODEL`, `OPENROUTER_JUDGE_MODEL`). `aiModel` en la DB
  ya no se lee.
- **Token**: `agent_profile.ai_token_cipher` (cifrado, guardado desde Configuracion) tiene prioridad;
  `OPENROUTER_API_TOKEN` es el respaldo de despliegue. Sin clave en la BD manda la env var — que es
  el estado de la instancia actual (`ai_token`/`ai_token_cipher` vacios).
- Modelo por defecto en el compose: `openai/gpt-oss-120b` (agente) y `openai/gpt-oss-20b` (juez)
- Base URL: `https://api.groq.com/openai`
- La UI de "Proveedor de IA" no existe; lo unico que se configura desde Configuracion es la clave

## Better Auth

- Autenticacion basada en sesiones
- Plugin organization para multi-tenancy (alta de negocios restringida al dueno de instancia)
- Passwords hasheados con **scrypt** (`node:crypto`, el default de Better Auth; no hay bcrypt en
  las dependencias)

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
| `/api/settings/instagram` | GET/PUT/DELETE | Consultar, editar o desconectar Instagram del CRM |
| `/api/settings/messenger` | GET/PUT | Config Messenger |
| `/api/settings/tiktok` | GET/PUT | Config TikTok |
| `/api/settings/webhook` | GET | URLs de webhooks |
| `/api/settings/branding/*` | GET/PUT | Branding white-label |
| `/api/settings/team` | GET/PUT | Equipo |
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
|  Capa 6: HTTPS + log (Caddy auto-HTTPS)  |
+------------------------------------------+
|  Capa 5: Rate Limit (bucket en Postgres) |
+------------------------------------------+
|  Capa 4: HMAC Webhook Verification       |
+------------------------------------------+
|  Capa 3: Better Auth (sesion + scrypt)   |
+------------------------------------------+
|  Capa 2: AES-256-GCM (secretos en reposo)|
+------------------------------------------+
|  Capa 1: Multi-tenancy (scoped queries)  |
+------------------------------------------+

  Transversales (no son una capa de red): contencion de rutas de media,
  cabeceras de respuesta en next.config.ts, gate de alta de organizaciones.
```

### Capa 1: Multi-tenancy
Toda tabla de dominio tiene `organization_id NOT NULL`. Todas las queries pasan por `scoped()`:
```typescript
// src/lib/db/tenant.ts
export function scoped<T>(query: T, organizationId: string): T {
  // Agrega WHERE organization_id = ?
}
```

Aislamiento no solo de lectura, tambien de alta: el plugin de Better Auth expone
`POST /api/auth/organization/create` a cualquier sesion valida, y `allowUserToCreateOrganization`
(`src/lib/auth/index.ts:110`) lo restringe al dueno de la instancia. Sin eso, un miembro de un
negocio ya creado abria un tenant propio — y sin sembrar (embudo, canales y perfil de agente
ausentes), porque esa ruta no pasa por `provisionOrganization()`.

En las paginas publicas la marca se resuelve fail-closed: si el negocio no se puede determinar
con certeza, no se muestra ninguna.

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
- Passwords hasheados con scrypt (`node:crypto`); no hay bcrypt en el arbol de dependencias
- Tokens de sesion con expiracion
- Registro publico cerrado por defecto (`ALLOW_SIGNUP=false`, gate FR-060 en `/sign-up/email`)

### Capa 4: Verificacion HMAC
```typescript
// Verificacion de webhooks Meta
const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
const signature = req.headers["x-hub-signature-256"];
if (signature !== `sha256=${expected}`) return 401;
```

Estado real de cada fuente:

| Fuente | Firma | Sin firma |
|--------|-------|-----------|
| Meta Cloud API (WhatsApp/IG/Messenger) | `X-Hub-Signature-256` contra `META_APP_SECRET` | Si `META_APP_SECRET` esta vacio la capa queda desactivada y se acepta por token de URL, con un aviso una sola vez por proceso. Fail-closed aqui descartaria mensajes reales de clientes |
| Zernio (IG/Messenger/TikTok) | `x-zernio-signature` / `x-late-signature` HMAC del body crudo, con el `webhook_secret` **de esa cuenta** | Con secreto guardado, la firma es **obligatoria**: sin cabecera → 401. Sin secreto, capa desactivada |
| WAHA | Token de la URL = HMAC(`waha:{orgId}`) por negocio | El token identifica al tenant y se resuelve **antes** de mirar `session`; un token que no pertenece a ningun negocio se descarta |

### Capa 5: Rate Limiting
- Bucket distribuido en PostgreSQL (`rate_limit_bucket` + `checkDistributedRateLimit`):
  sobrevive a varias replicas sin Redis. Si la tabla falla, **no** bloquea (fail-open) para
  no descartar webhooks legitimos; queda en el log.
- Login/registro: `AUTH_RATE_LIMIT` = 10 intentos / 10 minutos por IP.
- Alta de negocio (`POST /api/auth/organization`): misma ventana, bucket `org-provision:<userId>`.
- Webhooks: `WEBHOOK_RATE_LIMIT` = 120/min por token+IP → 429.
- Bot API: 600 requests/minuto.
- Origen de la IP: primero `x-real-ip` (lo escribe Caddy con `header_up X-Real-IP`) y, si falta,
  el **ultimo** hop de `X-Forwarded-For`. El primer hop lo escribe el cliente, asi que no es de fiar.

### Capa 6: HTTPS
- Caddy auto-HTTPS con Let's Encrypt
- Sin configuracion manual de certificados
- Log de accesos activado (`log` en el bloque del sitio): un acceso por peticion, con tope de
  rotacion `10m` x 3 archivos en el compose

### Controles anadidos por la auditoria de 2026-10-19

No encajan en la torre de 6 capas porque no son de red ni de identidad:

- **Contencion de rutas de media** (`src/server/media-path.ts`): valida segmento a segmento,
  normaliza con `resolve`, exige pertenencia al `MEDIA_DIR/{orgId}` y compara `realpath`
  (cierra enlaces simbolicos). Ruta invalida → `null` → 422 en las rutas publicas.
- **Cabeceras de respuesta globales** (`next.config.ts` → `headers()`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=15552000`.
  Viajan en la imagen, no en el proxy, para ser reproducibles desde el repo. **Sin CSP global a
  proposito**: Tailwind inyecta estilos en linea y una CSP mal calibrada rompe la UI en produccion.
- **CSP de media**: el unico contenido que controla un tercero (SVG del logo) lleva
  `default-src 'none'; style-src 'unsafe-inline'; sandbox` en su propia respuesta.
- **Sin reenvio de `err.message`** al cliente en `/api/settings/clients` y `/api/settings/team`:
  codigo de error generico (`client_creation_failed` / `member_creation_failed`) y el detalle real
  solo al log del servidor. Antes un fallo de BD filtraba su mensaje interno.

## Constitucion (Reglas No Negociables)

1. **Soberania (II)**: El nucleo depende solo de WhatsApp Cloud API + proveedor LLM. Prohibido S3, email, billing u otros terceros en el nucleo. Un tercero solo entra como conector opcional detras de feature flag.

2. **Seguridad (I)**: Secretos cifrados en reposo. Jamas al cliente ni a logs. Token de WhatsApp solo muestra ultimos 4 caracteres.

3. **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio. Toda query pasa por `scoped()`.

4. **Idempotencia (IV)**: Webhooks dedup por `wa_message_id` UNIQUE. Estados monotonos. Seeds y migraciones re-ejecutables.

5. **Sandbox del Laboratorio**: Conversaciones `is_test` JAMAS tocan la API real. El sender lanza excepcion si se intenta.

---

# 15. DESPLIEGUE EN PRODUCCION (VM + Docker Compose)

El despliegue real es una VM de Azure (`Standard_B2ats_v2`, 1 GiB de RAM) con `docker compose`
en `~/crm-lumarketing/`: `app` (imagen desde Docker Hub), `postgres` y `caddy`. No hay panel
intermedio — la epoca de EasyPanel/Traefik quedo atras; el proxy es Caddy y la orquestacion es
el compose versionado en el repo.

## Paso 0: La cadena automatica

`git push` a `main` → `docker.yml` construye la imagen, la sube como `ghostbreakfast69/lumark-crm:latest`
y entra por SSH a la VM a hacer `compose pull && compose up -d`. Es decir: **el push es el deploy**.
No hay paso humano, y un push directo no lo frena la proteccion de rama (los *required checks*
solo gatean merges de PR). La redaccion de este paso es la razon de ser del guard de migraciones
y de los 5 gates locales antes de empujar.

## Paso 1: PostgreSQL

Servicio `postgres` del compose: `postgres:16-alpine`, volumen nombrado `postgres_data`,
`POSTGRES_DB=lumark`, `POSTGRES_PASSWORD` desde el `.env` de la VM, healthcheck `pg_isready` y
tuning explicito para 1 GiB. La app lo arranca despues (`depends_on: service_healthy`) y se
conecta por el nombre de servicio interno (`postgres`), nunca por un host externo.

## Paso 2: Servicio de App

`image: ${APP_IMAGE:-ghostbreakfast69/lumark-crm:latest}` — el VPS no compila. Para congelar una
version (o revertir) se pone el digest en el `.env` del servidor:

```bash
APP_IMAGE=ghostbreakfast69/lumark-crm@sha256:<digest>
docker compose up -d app
```

El digest anterior se lee con `docker image inspect <id> --format '{{json .RepoDigests}}'`
(`RepoDigests` **no** existe en `docker container inspect`). Puerto 3000 sin publicar: solo 80/443.

## Paso 2b: Despliegue manual equivalente (una replica nueva)

1. Clonar el repo, copiar `.env.example` → `.env` y rellenar (§15 Paso 3).
2. `docker compose up -d` — arranca postgres, espera sano, aplica migraciones en el `CMD` de la
   app y levanta Caddy con el `Caddyfile` montado.
3. El volumen `media_data` debe pertenecer al usuario `lumark` (uid del runner); si se monta un
   bind mount desde el host hay que conservar el propietario o la escritura de adjuntos falla.

## Paso 3: Variables de Entorno

```bash
# Base de datos (la arma el compose desde POSTGRES_PASSWORD; DATABASE_URL no se pone a mano)
POSTGRES_PASSWORD=(generar: openssl rand -base64 24)

# Proxy / TLS
DOMAIN=crm.tudominio.com
APP_BASE_URL=https://crm.tudominio.com

# Autenticacion
BETTER_AUTH_SECRET=(generar: openssl rand -base64 32)

# Cifrado
ENCRYPTION_KEY=(generar: openssl rand -base64 32)

# WhatsApp (Meta)
META_WEBHOOK_VERIFY_TOKEN=(token de verificacion)
META_APP_SECRET=(firma HMAC; vacio = capa desactivada con aviso en el log)

# Canales
CHANNELS=whatsapp,instagram,messenger,tiktok

# IA (solo env vars — v1.4.0+)
OPENROUTER_BASE_URL=https://api.groq.com/openai
OPENROUTER_API_TOKEN=(api key)
OPENROUTER_MODEL=openai/gpt-oss-20b

# WAHA (opcional)
WAHA_BASE_URL=https://waha.tudominio.com
WAHA_API_KEY=(api key)
WAHA_TRUSTED_HOSTS=localhost        # hosts privadas toleradas para un WAHA interno (sin HTTPS)

# Banderas de modulo (ADR-001, apagadas por defecto)
INTEL=true
AGENDA=
ATRIBUCION=
GOOGLE_BUSINESS=

# MCP (conectores externos)
MCP_DCR_ENABLED=true
MCP_DCR_ALLOWED_HOSTS=chatgpt.com
MCP_WRITE_ENABLED=false
MCP_DELETE_ENABLED=false
MCP_SEND_ENABLED=false
MCP_ADMIN_ENABLED=false

# Operaciones
ALLOW_SIGNUP=false        # registrar clientes nuevos: solo el dueno de instancia
AGENT_COALESCE_MS=6000
MEDIA_DIR=/data/media

# Congelar version (opcional; vacio = sigue `latest`)
APP_IMAGE=
```

**Trampa del compose**: el bloque `environment:` es una **lista nominal**. Una variable que no
aparece ahi no llega al proceso aunque exista en `.env` — asi fue como la bandera `INTEL` dejaba
`/inteligencia` en 404 en una replica del repo. Cualquier variable nueva tiene que estar en el
compose del repo **y** en el del servidor.

**Trampa del `.env`**: no se anexa con `>>`. Si la ultima linea no termina en salto, las claves se
pegan (`MCP_AUDIT_RETENTION_DAYS=180MCP_DCR_ENABLED=true`). Reescribir el archivo completo y
verificar con `grep -c '^CLAVE=' .env`.

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
   - URL: `https://tudominio.com/api/webhooks/wa/{META_WEBHOOK_VERIFY_TOKEN}`
   - Fields: `messages`, `messaging_postbacks`
   - La ruta real es `src/app/api/webhooks/wa/[webhookToken]` (no existe `/webhooks/whatsapp`)

## Paso 6: Activar Canales

- Editar `CHANNELS` en el `.env` de la VM y `docker compose up -d app` (recrea el contenedor;
  `restart` no vuelve a leer `.env`)
- Agregar `tiktok` si se desea: `CHANNELS=whatsapp,instagram,messenger,tiktok`
- TikTok/Instagram/Messenger via Zernio exigen ademas el `api key` en Settings -> [Canal]

## Paso 7: Configurar Dominio Personalizado

### 7.1 Configurar DNS en tu proveedor

Apuntar el subdominio a la IP publica de la VM (se lee con `dig +short crm.tudominio.com`; no se
fija en la documentacion porque cambia con cada redeploy y porque el registro A no es un secreto
pero si un dato operativo):

| Tipo | Nombre | Apunta a | TTL |
|------|--------|----------|-----|
| **A** | `crm` | IP publica de la VM de Azure | 3600 |

### 7.2 El dominio lo resuelve Caddy, no un panel

No hay que registrar el dominio en ningun panel: Caddy ve `{$DOMAIN}` en el `Caddyfile`, pide el
certificado a Let's Encrypt en el primer arranque y renueva solo. Los pasos reales:

```bash
cd ~/crm-lumarketing
# 1. DOMAIN y APP_BASE_URL en .env (lista nominal del compose: ambas deben estar declaradas)
# 2. validar el Caddyfile antes de tocar el servicio vivo
docker run --rm -v $PWD/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile
# 3. recrear caddy (o recargar si solo cambio el Caddyfile)
docker compose up -d caddy          # si cambio DOMAIN en .env
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile   # si cambio el archivo
```

Si se edita el `Caddyfile` en el servidor, reescribirlo **en el sitio** (`cat nuevo > Caddyfile`),
nunca con `mv`: el bind mount sigue el *inode* y el contenedor se queda leyendo el archivo viejo.

### 7.3 Actualizar APP_BASE_URL

```
APP_BASE_URL=https://crm.tudominio.com
DOMAIN=crm.tudominio.com
```

y `docker compose up -d app`. Esto asegura que los links internos (webhooks, auth, branding
publico) usen tu dominio. Un `APP_BASE_URL` equivocado se ve en los enlaces de invitacion y en el
callback OAuth del MCP (`MCP_AUTH_BASE_URL`/`MCP_RESOURCE_URL`).

### 7.4 Actualizar Webhooks

Despues de configurar el dominio, actualizar las URLs de webhook en:

- **Meta/Facebook** (WhatsApp Business): `https://crm.tudominio.com/api/webhooks/wa/{token}`
- **Meta/Facebook** (Instagram): `https://crm.tudominio.com/api/webhooks/ig/{token}`
- **Messenger**: `https://crm.tudominio.com/api/webhooks/messenger/{token}`
- **Zernio**: `https://crm.tudominio.com/api/webhooks/ig/{token}` (IG/TikTok) y `.../messenger/{token}`
- **WAHA**: `https://crm.tudominio.com/api/webhooks/waha/{token}` — el token es
  `wahaWebhookToken(orgId)`, especifico del negocio, no el verify token de la instancia

### Flujo de conexion

```
Usuario escribe crm.tudominio.com
    ↓ DNS (registro A)
    ↓ IP publica de la VM (puertos 80/443 abiertos en el NSG)
    ↓ Contenedor Caddy (auto-HTTPS, log de accesos, X-Real-IP)
    ↓ Contenedor app:3000 (puerto NO publicado)
    ↓ Next.js responde + cabeceras de next.config.ts
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

**Solucion**: Verificar la password actual en el `.env` de la VM (`POSTGRES_PASSWORD`, de la que
`docker-compose.yml` arma `DATABASE_URL`) y recrear el servicio `app` con
`docker compose up -d app`. (En la epoca del incidente el panel era EasyPanel; hoy el despliegue
es VM + compose, ver §15.)

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

**Fecha**: 20 de Septiembre de 2026 (fix) → **revertido el 19 de Octubre de 2026**  
**Severidad**: Alta  
**Sintomas**: Webhooks de Zernio (Instagram/Messenger/TikTok) retornaban 401

**Causa original**: `isValidZernioSignature()` rechazaba requests sin firma cuando la DB tenia un
`webhookSecret` guardado. Pero Zernio no envia firma si el webhook no tiene signing secret
configurado en su panel.

**Solucion de 2026-09-20** (`34a578a`): aceptar requests sin firma.

```typescript
// Como quedo en septiembre (fail-open):
if (!signature) return true; // "el token de la URL ya valido la fuente"
```

**Por que se revirtio (19 de octubre de 2026, hallazgo A-03 de la auditoria)**: la linea del fix
vivia **despues** de `if (!secret) return true`, asi que el caso de cuenta sin secreto ya estaba
cubierto por la primera comprobacion; la segunda devolvia `true` tambien cuando el secreto **si**
existia. Con secreto en la cuenta, un evento sin cabecera se aceptaba solo por conocer el segmento
secreto de la URL — que es justo lo que la firma debe suplir: quien inyecta un DM falso hace que el
agente conteste con un mensaje **real** desde la cuenta del cliente.

**Estado actual**:

```typescript
// src/server/zernio/index.ts:43-49
if (!secret) return true;      // sin secreto guardado la capa sigue desactivada
if (!signature) return false;  // con secreto, la firma es obligatoria
```

Es decir: el caso que motivaba el bug (cuenta **sin** signing secret en Zernio) sigue sin
requerir firma; lo que cambio es que una cuenta **con** secreto ya no puede ser suplantada
omitiendo la cabecera.

**Verificacion**: `tests/unit/webhook.test.ts` (`describe("firma de Zernio…")`) cubre los cuatro
casos — sin secreto, con secreto y firma valida, con secreto y firma invalida, con secreto y sin
cabecera.

**Impacto en produccion**: nulo en el momento del cambio (0 cuentas con `webhook_secret` en la BD).
Si algun dia un canal deja de ingestar con 401, comparar el secreto guardado en Ajustes con el que
Zernio usa para firmar, en lugar de volver a aflojar la validacion.

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

**Como esta hoy (verificado en codigo, 2026-10-19)**: de los 4 puntos persisten el 1 y parte del 3.
El modelo **si** se define solo por entorno. El token **no**: `resolveAiConfig()`
(`src/lib/ai/index.ts:70-89`) da prioridad al token guardado en la BD (cifrado, compartido entre
agente y copiloto) y usa `OPENROUTER_API_TOKEN` como respaldo de despliegue, que es lo contrario
del punto 2/4. La UI de "Proveedor de IA" sigue fuera. Donde mirar antes de tocar esto: el campo
`ai_token_cipher` de `agent_profile` — si esta vacio, quien decide es la variable de entorno.

## Bug 12: Suplantacion por URL en media publica (P0)

**Fecha del hallazgo**: 19 de Octubre de 2026 (auditoria de modo varios negocios)  
**Severidad**: Critica  
**Simptomas**: `GET /api/media/public/{orgId}/../../..%2f..%2fproc%2fself%2fenviron` respondia sin
sesion. La ruta validaba el segmento con `/^[\w.-]{1,128}$/`, una clase que **incluye el punto**, asi
que `..` pasaba; luego `join()` + `existsSync()` leian cualquier archivo del contenedor.

**Alcance real**: cualquiera, sin credenciales, leia el entorno del proceso — `ENCRYPTION_KEY`,
`BETTER_AUTH_SECRET`, `DATABASE_URL` con la password de Postgres, `OPENROUTER_API_TOKEN` — y con la
clave de cifrado, todos los secretos de terceros guardados en la BD.

**Solucion**: helper unico `src/server/media-path.ts` → `resolveMediaFile(orgId, ...segmentos)`.
Regla por segmento `^[A-Za-z0-9][\w.-]{0,127}$` (no puede empezar con punto, asi que `..` es
imposible), `resolve()` para normalizar, comprobacion de prefijo `MEDIA_DIR/{orgId}` + `sep`, y
`realpathSync` de archivo y raiz para cerrar enlaces simbolicos. Ruta invalida → `null` → **422**;
ruta valida sin archivo → **404**. Lo consumen las dos rutas publicas de media, el PDF de
cotizaciones (`src/server/documents/pdf.ts`) y `src/server/whatsapp/media.ts`.

Ademas: `X-Content-Type-Options: nosniff` en todas las respuestas de media y
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` en los SVG, porque
el logo admite SVG y lo sube un miembro del negocio (un SVG con script se habria ejecutado con la
sesion de quien abriera la URL).

**Verificacion**: `tests/unit/media-path.test.ts` (12 casos: `../../secreto.txt`, `catalog/..`,
`....`, `..%2fetc`, orgId invalido, segmento absoluto, salida por symlink, archivo ausente,
cabeceras). En produccion, tras el deploy: `....` y `%2e%2e%2f…proc%2fself%2fenviron` responden 422
y el logo real responde 200 con `nosniff`.

**Commit**: `1436d95`

---

# 17. TESTING Y VERIFICACION

## Unit Tests (Vitest)

1086 tests en 124 archivos (medido el 2026-10-19, `pnpm test` en 15.5 s) cubriendo:

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
| Media path | `media-path.test.ts` (traversal, symlink escape, cabeceras de media) |
| Webhooks | `webhook.test.ts` (firma de Zernio con y sin secreto, enrutado WAHA) |
| Window | `window.test.ts` |

## Scripts E2E (Playwright)

21 scripts que cubren flujos de comportamiento completos:

| Script | Flujo |
|--------|-------|
| `e2e-selftest.mjs` | Test comprehensive: BSUID, bot API, agenda, atribucion |
| `e2e-lumark.mjs` | Flujos LUMARK: login, catalogo, cotizaciones, proyectos |
| `e2e-bitacora-etapas.mjs` | Eventos de etapa del pipeline |
| `e2e-send-failure.mjs` | Visualizacion de envios fallidos |
| `e2e-search-filters.mjs` | Busqueda y filtros del inbox |
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
# --- En la VM (desde ~/crm-lumarketing) ---

# Verificar salud y QUE commit esta corriendo (viene quemado en la imagen)
curl https://crm.tudominio.com/api/health
# Sondear desde dentro de la red docker: desde la propia VM el HTTPS del dominio no responde
# (el cliente interno habla HTTP a un listener TLS y sale code=000)
docker compose exec caddy wget -qO- http://app:3000/api/health

# Ver logs del contenedor
docker compose logs --tail 100 -f app

# Ver logs de PostgreSQL
docker compose logs --tail 100 -f postgres

# Estado y reinicios (un RestartCount alto = el CMD aborta, casi siempre por migraciones)
docker compose ps
docker inspect -f '{{.RestartCount}}' crm-lumarketing-app-1

# Consultas (psql corre DENTRO del contenedor)
docker compose exec postgres psql -U postgres -d lumark -c "\dt"
docker compose exec postgres psql -U postgres -d lumark \
  -c "SELECT COUNT(*) FROM drizzle.__drizzle_migrations;"

# Resetear password de usuario
node scripts/reset-password.mjs

# Seed de demo — en multi-tenant el negocio es OBLIGATORIO (evita sembrar en el
# CRM de un cliente)
pnpm seed:demo --org=<organizationId>

# Correr tests
pnpm typecheck && pnpm lint && pnpm test

# Guard de migraciones: journal ↔ .sql (falla si un entrada del journal no tiene archivo)
pnpm db:guard

# Generar migracion
pnpm db:generate

# Aplicar migraciones (se hace automaticamente al arrancar el contenedor)
node scripts/migrate.mjs
```

## Como Actualizar

El camino normal es **no tocar la VM**: `git push origin main` → `docker.yml` construye, sube
`latest` y hace `compose pull && up -d` por SSH. El manual equivalente:

```bash
cd ~/crm-lumarketing
docker compose pull app          # el VPS no compila: descarga la imagen publicada
docker compose up -d app         # recrea y aplica migraciones en el CMD
docker compose ps && curl -s https://crm.tudominio.com/api/health
```

Antes de un deploy que toca esquema: dump manual `pre-deploy-<UTC>.dump.gz` y **copia fuera de la
maquina**. Rollback: fijar `APP_IMAGE=…@sha256:<digest>` en `.env` y `docker compose up -d app`.

## Como Rotar Passwords

1. **PostgreSQL**: `docker compose exec postgres psql -U postgres -c "ALTER USER postgres PASSWORD 'nueva';"`
   (la BD ya tenia esa password; `POSTGRES_PASSWORD` del `.env` solo la impone en el primer arranque
   del volumen, no la cambia despues)
2. **Actualizar `POSTGRES_PASSWORD`** en el `.env` de la VM — el compose arma `DATABASE_URL` desde ella
3. `docker compose up -d app` (recrear, no `restart`: `restart` no vuelve a leer `.env`)
4. Verificar `/api/health` y que el log de la app no muestra `password authentication failed`

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
4. Registrar la entrada en `drizzle/meta/_journal.json` con un `when` **estrictamente mayor** que
   el ultimo (el orden de aplicacion es `when`, no el nombre del archivo). El indice siguiente se lee
   del propio journal: `node -e "console.log(require('./drizzle/meta/_journal.json').entries.length)"`.
   El journal tiene decenas de entradas: nunca hardcodear un numero en la documentacion.
5. **Commitear el `.sql` junto con el journal.** Un `journal` que referencia un archivo ausente es
   exactamente lo que tumbo la produccion el 2026-10-16: la imagen se construye igual, el `CMD`
   aborta en `migrate.mjs` y el contenedor entra en crash loop con 502 publico.
6. `pnpm db:guard` lo comprueba localmente y en CI/CD; una migracion huerfana (archivo sin journal)
   tambien es error, no aviso.
7. Antes de empujar, dry-run en una copia: restaurar un `pg_dump` en una BD de pruebas y aplicar el
   `.sql` con `ON_ERROR_STOP=1`
8. Las migraciones se aplican automaticamente al arrancar el contenedor

## Monitoreo

- **Healthcheck**: `GET /api/health` cada 15s, 5 reintentos y `start-period` de 40s (el margen cubre
  las migraciones del arranque)
- **Logs**: `docker compose logs app` / `postgres`; Caddy registra un acceso por peticion (rota a
  `10m` x 3 archivos). El aviso periodico de configuracion insegura es un `console.warn` en el log de
  `app`, por ejemplo `[webhook] META_APP_SECRET no esta configurado…`
- **Diagnosticos**: `/api/settings/diagnostics` (tabla `diagnostic_event`)
- **Eventos SSE**: `/api/events` para monitoreo en tiempo real
- **Copias de seguridad**: cron nocturno `~/scripts/backup-crm.sh` → `~/backups` (BD + media +
  configuracion) con linea `OK …` en `backup.log`. Mientras el backup viva en el mismo disco que la
  BD, no es un backup: hace falta copia fuera de la maquina

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
| **Zernio** | API unificada para Instagram, Messenger y TikTok |
| **WAHA** | WhatsApp HTTP API - alternativa self-hosted a Meta Cloud API |
| **window** | Ventana de 24h para responder mensajes gratuitamente |

## Referencias a Documentacion Interna

| Documento | Ubicacion | Contenido |
|-----------|-----------|-----------|
| CLAUDE.md | Raiz del proyecto | Guia para Claude Code |
| SISTEMA-COMPLETO.md | docs/ | Documentacion del sistema (~1900 lineas, reenumera §§ 1-32 + anexos) |
| Deuda tecnica | docs/deuda-tecnica.md | Inventario de bugs, codigo muerto y esquema inerte, con commit base |
| ADR-001 | docs/adr-001-canales-opcionales.md | Decision: canales opcionales |
| ADR-002 | docs/adr-002-conectores-de-agenda.md | Decision: conectores de agenda |
| Constitution | .specify/memory/constitution.md | Reglas no negociables |
| EasyPanel Guide | docs/easypanel.md | **Historica**: el despliegue actual es VM + Docker Compose + Caddy (§15) |
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

*Documento generado el 20 de Septiembre de 2026, alineado con el codigo el 19 de Octubre de 2026*
*Version 1.3.0 - CRM LUMARK (la version que reporta `/api/health`; `package.json` manda)*
