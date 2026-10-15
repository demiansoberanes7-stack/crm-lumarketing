# 02. Diagramas de arquitectura

Los diagramas describen el código y los archivos de configuración revisados en `main`. Una conexión dibujada es una dependencia arquitectónica, no prueba de que el proveedor esté disponible o autenticado.

## A. Arquitectura general

~~~mermaid
flowchart LR
    U[Usuario] --> B[Navegador React]
    B -->|HTTPS| C[Caddy :80/:443]
    C -->|red Compose :3000| N[Next.js UI + API]
    N --> S[src/server: negocio]
    S --> L[src/lib: helpers/configuración]
    L --> D[(PostgreSQL 16)]
    S --> W[WhatsApp Cloud API / WAHA]
    S --> Z[Zernio y canales]
    S --> AI[Proveedor LLM compatible]
    S --> G[Google APIs / GA4]
    S --> M[Meta Graph / CAPI]
    S --> ML[Mercado Libre]
    S --> E[SMTP / IMAP]
~~~

## B. Infraestructura Docker descrita por Compose

~~~mermaid
flowchart TB
    Internet -->|80 / 443| Caddy
    subgraph VM["VM descrita para producción; estado actual pendiente"]
      Caddy["caddy:2-alpine"]
      App["app: Next.js standalone :3000"]
      DB[("postgres:16-alpine / lumark")]
      Media[("media_data → /data/media")]
      Data[("postgres_data")]
      TLS[("caddy_data / caddy_config")]
      Caddy -->|app:3000| App
      App -->|postgres:5432| DB
      App --> Media
      DB --> Data
      Caddy --> TLS
    end
~~~

En el Compose inspeccionado, Caddy publica puertos 80 y 443. PostgreSQL no declara publicación del puerto 5432 hacia el host.

## C. Comunicación frontend-backend

~~~mermaid
sequenceDiagram
    actor U as Usuario
    participant UI as Página React
    participant API as Route Handler
    participant AUTH as withAuth / validación
    participant S as src/server
    participant DB as Drizzle / PostgreSQL
    U->>UI: Acción del usuario
    UI->>API: Solicitud HTTP
    API->>AUTH: Sesión y validación cuando corresponde
    AUTH-->>API: Contexto autorizado o error
    API->>S: Ejecutar regla de negocio
    S->>DB: Consulta o escritura
    DB-->>S: Resultado
    S-->>API: Respuesta de negocio
    API-->>UI: JSON / status HTTP
~~~

## D. Mensajes y eventos en vivo (flujo conceptual)

~~~mermaid
sequenceDiagram
    participant P as Proveedor de canal
    participant WH as Webhook
    participant ING as Módulo de ingesta
    participant DB as PostgreSQL
    participant SSE as Eventos/SSE
    participant UI as Bandeja
    P->>WH: Notificación de mensaje
    WH->>ING: Validar y normalizar payload
    ING->>DB: Persistir contacto/conversación/mensaje
    DB-->>ING: Confirmación de escritura
    ING->>SSE: Publicar evento
    SSE-->>UI: Actualización al navegador
~~~

Los pasos exactos cambian entre los proveedores; revisar los handlers concretos antes de cambiar validación o idempotencia.

## E. Pipeline, adquisición y venta

~~~mermaid
flowchart TD
    Channel[Canal de adquisición] --> Contact[Contacto]
    Contact --> Lead[Lead]
    Lead --> Stage[Etapa comercial]
    Stage --> Hist[Historial de etapas]
    Lead --> Qual[Cualificación]
    Lead --> Quote[Cotización]
    Quote --> Sale[Cobro / venta]
    Stage -->|pérdida| Loss[Motivo de pérdida]
    Channel --> Campaign[Campaña / oferta / creatividad]
    Campaign --> Attribution[Eventos de atribución]
    Sale --> KPI[KPI comercial]
    Attribution --> KPI
    Cost[Costos por servicio] --> KPI
~~~

Las entidades se encuentran en el esquema; no todos los contactos necesariamente tienen campaña atribuida ni toda cotización representa una venta cobrada.

## F. Ciclo de cotización revisado

~~~mermaid
sequenceDiagram
    actor V as Vendedor
    participant UI as Cotizador
    participant API as /api/quotes
    participant S as src/server/quotes/service
    participant DB as PostgreSQL
    V->>UI: Captura conceptos
    UI->>API: POST JSON
    API->>API: Validación Zod
    API->>S: Crear con organización de sesión
    S->>DB: Guardar cotización y conceptos
    DB-->>S: Resultado
    S-->>API: ID/resultado
    API-->>UI: JSON
~~~

## G. Build y despliegue

~~~mermaid
sequenceDiagram
    actor Dev as Desarrollador
    participant GH as GitHub main
    participant CI as Workflow CI
    participant DH as Docker Hub
    participant VM as VPS por SSH
    Dev->>GH: Push a main
    GH->>CI: typecheck, lint, test, build
    GH->>DH: Construir y publicar imagen
    GH->>VM: Ejecutar paso SSH si está configurado
    VM->>DH: Pull de imagen
    VM->>VM: docker compose up -d --no-deps app
    VM->>App: Healthcheck /api/health
~~~

La figura refleja lo declarado en `.github/workflows`; para validar una ejecución hay que revisar el run y la VM.

## H. Fuentes de verdad del diagrama

- Datos: `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/db/tenant.ts`
- API: `src/app/api/**/route.ts`
- Negocio: `src/server/**`
- Contenedores: `Dockerfile`, `docker-compose.yml`, `Caddyfile`
- Automatización: `.github/workflows/ci.yml`, `.github/workflows/docker.yml`
