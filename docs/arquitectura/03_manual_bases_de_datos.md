# 03. Manual de bases de datos

## 1. Inventario y fuente de verdad

La configuración inspeccionada usa **PostgreSQL 16 Alpine** mediante el servicio `postgres` de `docker-compose.yml`, con base predeterminada `lumark`. No se encontró Supabase como base primaria en el Compose revisado. No se abrió una conexión a la base de producción.

| Capa | Ruta | Responsabilidad |
|---|---|---|
| Modelo de datos | `src/lib/db/schema.ts` | Declaraciones Drizzle del esquema relacional. |
| Cliente DB | `src/lib/db/index.ts` | Crea cliente `postgres.js` a partir de `DATABASE_URL` y expone Drizzle. |
| Scope por organización | `src/lib/db/tenant.ts` | `scoped()` obliga a suministrar `organizationId` no vacío. |
| Configuración de migraciones | `drizzle.config.ts` | Apunta al esquema fuente y carpeta `drizzle/`. |
| Migraciones | `drizzle/*.sql` y `drizzle/meta/_journal.json` | Cambios versionados del esquema. |
| Archivos multimedia | volumen `media_data` montado en `/data/media` | Archivos no relacionales de la aplicación. |

## 2. Hechos detectados

- Declaraciones `pgTable` en esquema: **90**.
- Campos/columnas del diccionario extraídos: **1114**.
- Archivos SQL de migración: **63**.
- Entradas del journal de Drizzle: **62**.
- El journal/archivos visibles llegan a la familia `0063_contact_purchase`; hay un salto en la numeración después de `0061`. No renumerar: primero cotejar historial Git y la tabla de migraciones de la instancia activa.

Los conteos corresponden a la revisión estática. Los constructores de Drizzle se guardan como tipo base; detalles como longitud, precisión, valores por defecto, callbacks, índices compuestos y restricciones deben consultarse en el código original.

## 3. Dominios principales del esquema

| Dominio | Tablas representativas |
|---|---|
| Usuarios y organizaciones | `user`, `session`, `account`, `organization`, `member`, `invitation` |
| Contactos e inbox | `contact`, `conversation`, `message`, `media_asset`, `contact_note` |
| Ventas y pipeline | `lead`, `pipeline_stage`, `lead_stage_event`, `qualification_criteria`, `loss_reason_catalog` |
| Cotización y finanzas | `quote`, `quote_item`, `quote_event`, `charge`, `payment`, `expense` |
| Adquisición y campañas | `acquisition_channel`, `campaign`, `ad_set`, `ad_creative`, `offer`, `service_cost` |
| Atribución/analítica | `attribution_event`, `ad_attribution`, `conversion_event`, `campaign_insight`, `sync_state` |
| Experimentos | `experiment`, `experiment_variant`, `experiment_observation` |
| Proyectos y agenda | `project`, `project_stage`, `project_step`, `project_task`, `booking`, `calendar_settings` |
| Canales/integraciones | credenciales Meta, Instagram, Messenger, TikTok, WAHA, Zernio e `integration` |
| Inteligencia | `intel_credentials`, `intel_term`, snapshots y entidades relacionadas |
| Email/automatización | `email_account`, `email_message`, `automation_execution`, tareas `caltodo` |
| Agente y conocimiento | `agent_profile`, `kb_entry`, `agent_test_run`, `agent_test_case`, `copilot_settings` |

Este agrupamiento es una guía para lectura, no una definición de dominio formal ni una garantía de que todas las entidades se unan en cada flujo.

## 4. Modelo entidad-relación (núcleo)

~~~mermaid
erDiagram
    ORGANIZATION ||--o{ MEMBER : incluye
    USER ||--o{ MEMBER : pertenece
    ORGANIZATION ||--o{ CONTACT : posee
    CONTACT ||--o{ CONVERSATION : tiene
    CONVERSATION ||--o{ MESSAGE : contiene
    CONTACT ||--o{ LEAD : origina
    PIPELINE_STAGE ||--o{ LEAD : clasifica
    LEAD ||--o{ LEAD_STAGE_EVENT : historial
    ORGANIZATION ||--o{ QUOTE : posee
    QUOTE ||--o{ QUOTE_ITEM : incluye
    ORGANIZATION ||--o{ CAMPAIGN : organiza
    CAMPAIGN ||--o{ AD_SET : agrupa
    AD_SET ||--o{ AD_CREATIVE : contiene
    ORGANIZATION ||--o{ EXPERIMENT : define
    EXPERIMENT ||--o{ EXPERIMENT_VARIANT : tiene
    EXPERIMENT_VARIANT ||--o{ EXPERIMENT_OBSERVATION : registra
~~~

**Importante:** el diagrama es un mapa simplificado de entidades principales; no constituye un volcado exhaustivo de todas las foreign keys. El CSV incluye referencias detectadas automáticamente en declaraciones `references()`. Las relaciones definidas con índices, callbacks o únicamente por lógica de aplicación necesitan revisión manual.

## 5. Diccionario de datos

El archivo [03b_diccionario_datos.csv](03b_diccionario_datos.csv) enumera las declaraciones de columna reconocidas, el nombre ORM, columna SQL, constructor, campos obligatorios/PK/únicos detectados, referencias y descripción conservadora.

- **Obligatorio:** se encontró `.notNull()` o `.primaryKey()` en la declaración.
- **Único explícito:** detecta `.unique()` por columna; no recoge todos los índices únicos compuestos.
- **Referencia:** copia las referencias explícitas `references(() => tabla.campo)` reconocidas.
- **Descripción:** usa comentarios cercanos cuando existen; cuando no, deja un aviso en lugar de inventar semántica.

Utiliza `src/lib/db/schema.ts` y las migraciones SQL como fuente de verdad antes de diseñar cambios de estructura.

## 6. Aislamiento y seguridad

El patrón de consultas debe limitar los datos a la organización autenticada. `scoped(organizationColumn, organizationId, ...conditions)` lanza error si el ID de organización está vacío y combina condiciones. Revisar las consultas, joins, exportaciones, webhooks, pollers y tareas en segundo plano; la existencia del helper no demuestra cobertura completa.

No se ha conectado a PostgreSQL activo: no se confirman filas, volumen, índices realmente instalados, migraciones aplicadas ni estado de backup.

## 7. Respaldo y recuperación

La recuperación debe contemplar por separado:
1. Dump de PostgreSQL.
2. Volumen de medios `/data/media`.
3. Variables y configuración segura (sin guardar secretos dentro de documentación).
4. Tag/digest de imagen y commit asociado.
5. Ensayo de restauración en entorno aislado.

Comandos de inspección, no destructivos:

~~~bash
docker compose ps
docker compose exec -T postgres pg_isready -U postgres
docker compose exec -T postgres psql -U postgres -d lumark -c 'SELECT current_database(), current_timestamp;'
docker volume ls
~~~

No ejecutes restauraciones ni migraciones sobre producción sin confirmar destino, respaldo, compatibilidad y ventana de mantenimiento.
