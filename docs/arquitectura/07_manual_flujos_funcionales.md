# 07. Manual de flujos funcionales

Este manual describe recorridos reconstruidos a partir del código. Los diagramas no reemplazan pruebas de extremo a extremo en un entorno de prueba.

## 1. Consultar el pipeline

El handler `src/app/api/pipeline/board/route.ts` usa `withAuth`, obtiene etapas y leads de la organización de sesión mediante `scoped()`, une el contacto y opcionalmente una conversación, y devuelve moneda, etapas y tarjetas.

~~~mermaid
sequenceDiagram
  participant UI as Pantalla Pipeline
  participant API as GET /api/pipeline/board
  participant DB as Drizzle/PostgreSQL
  UI->>API: Solicita tablero
  API->>DB: Lee pipeline_stage por organizationId
  API->>DB: Lee lead + contact + conversation
  DB-->>API: Filas limitadas al tenant
  API-->>UI: currency, stages, leads
~~~

Prueba con dos organizaciones de datos de ejemplo para comprobar que tarjetas y métricas no se mezclan.

## 2. Crear una cotización

El handler `src/app/api/quotes/route.ts` confirma GET/POST. POST valida con Zod datos de contacto, ítems, cantidad, precio unitario, descuento, tasa de impuesto, vigencia y otros campos, y delega en `src/server/quotes/service`.

~~~mermaid
sequenceDiagram
  actor V as Vendedor
  participant UI as Cotizador
  participant API as POST /api/quotes
  participant S as quotes/service
  participant DB as PostgreSQL
  V->>UI: Captura contacto e ítems
  UI->>API: Envía JSON
  API->>API: Validación Zod
  API->>S: Crear dentro de organización
  S->>DB: Inserta cotización y líneas
  DB-->>S: Resultado
  S-->>API: Identificador/estado
  API-->>UI: Respuesta JSON
~~~

Pruebas de aceptación: cantidad cero rechazada, precio negativo rechazado, una cotización válida guardada y aislamiento entre organizaciones. Revisa el servicio para confirmar reglas de redondeo, moneda e impuestos antes de usar el módulo con fines contables.

## 3. Registrar campaña comercial

El handler `src/app/api/commercial/campaigns/route.ts` confirma GET/POST. GET lista campañas limitadas a `session.organizationId`; POST valida plataforma, nombre, ID externo, objetivo, estado, presupuesto planificado y fechas.

~~~mermaid
flowchart TD
  Channel[Canal de adquisición] --> Campaign[Campaña]
  Campaign --> AdSet[Conjunto de anuncios]
  AdSet --> Creative[Creatividad]
  Campaign --> Offer[Oferta]
  Lead[Contacto o lead] --> Attribution[Evento de atribución]
  Cost[Costo del servicio] --> KPI[KPI comercial]
  Campaign --> KPI
  Attribution --> KPI
~~~

El modelo contiene también experimentos y observaciones. Las métricas de plataforma no son automáticamente iguales a cobros del CRM: los tableros deben indicar origen, periodo, moneda y reglas de atribución.

## 4. Mensaje entrante y bandeja

Los módulos bajo `src/server/inbox`, `src/server/whatsapp`, `src/server/waha`, `src/server/instagram`, `src/server/messenger` y `src/server/tiktok` separan identidad, ingesta y envío. Existen rutas de webhooks en `src/app/api/webhooks`.

~~~mermaid
flowchart TD
  Provider[Proveedor] --> WH[Webhook del canal]
  WH --> Validate[Validación del evento]
  Validate --> Normalize[Normalizar identidad y mensaje]
  Normalize --> Dedupe[Deduplicación según proveedor]
  Dedupe --> DB[(Persistencia)]
  DB --> Events[Bus de eventos]
  Events --> SSE[Stream SSE]
  SSE --> UI[Bandeja]
  UI --> Send[API de envío]
  Send --> Adapter[Adaptador del canal]
  Adapter --> Provider
~~~

El esquema concreto de firma y clave idempotente cambia entre proveedores; no uses este diagrama para asumir que una política es idéntica en todos los canales.

## 5. Agente de IA y transferencia a persona

El código agrupa prompts, trigger, acciones y handoff en `src/server/ai`; el Laboratorio usa módulos de ejecuciones, personas de prueba y evaluación en `src/server/lab`.

~~~mermaid
sequenceDiagram
  participant C as Conversación
  participant AI as Trigger del agente
  participant LLM as Proveedor de lenguaje
  participant H as Handoff
  participant DB as PostgreSQL
  C->>AI: Mensaje entrante
  AI->>DB: Recupera contexto y conocimiento
  AI->>LLM: Solicita respuesta
  LLM-->>AI: Respuesta propuesta
  alt Se requiere intervención humana
    AI->>H: Transferir conversación
    H->>DB: Registrar estado
  else Respuesta automática permitida
    AI->>DB: Persistir respuesta y estado
  end
~~~

Prueba en un entorno aislado casos de respuesta normal, falta de conocimiento, error del proveedor, petición de persona y prohibición de enviar mensajes reales durante los tests del Laboratorio.

## 6. Healthcheck

`src/app/api/health/route.ts` ejecuta `SELECT 1`. Si la base responde, devuelve `ok: true` y puede incluir versión/commit. Si falla la conexión, devuelve HTTP 503 y `db_unavailable`. Este endpoint no es una prueba de WhatsApp, IA, email, sincronizadores ni todos los módulos.

## 7. Aceptación de un flujo

Un flujo se considera validado cuando hay evidencia de entrada válida e inválida, respuesta HTTP, datos persistidos, respeto de tenant, resultado visible en la UI, manejo de error externo y prueba de idempotencia cuando corresponda. Guarda evidencia redactada, sin tokens o contenido sensible de clientes.
