# Auditoría funcional — Zorro Tech

> Auditoría de solo lectura sobre el commit base `5ce91e2` (rama `feat/ciclo-comercial`).
> Stack real: Next.js 15 (App Router) + React 19 + TypeScript estricto, PostgreSQL + Drizzle ORM,
> Better Auth (plugin organization), Vitest (unit) + guiones E2E. Fork de Zorro Tech adaptado a Zorro Tech.
> Todo lo afirmado aquí está referenciado a `archivo:línea` del código real.

## Cómo leer esta matriz

- **Implementado**: funciona de punta a punta (UI → servicio → datos persistidos).
- **Parcial**: existe parte del flujo, pero falta cableado, UI o datos.
- **Pendiente**: modelado o previsto, sin productores/consumidores.
- **No confirmado**: requiere credenciales o entorno para verificarse.

---

## Matriz de estado por prioridad

| # | Prioridad del encargo | Estado | Evidencia (archivo:línea) | Brecha principal |
|---|---|---|---|---|
| P1 | Cotización aceptada → proyecto → orden de servicio | **Pendiente** | `quote` sin `projectId` (`schema.ts:1220-1263`); `project` sin `quoteId` (`schema.ts:1012-1063`); `changeQuoteStatus` solo descuenta stock (`quotes/service.ts:475-545`); no existe `service_order` | Falta vínculo de datos + disparo + entidad OS + plantillas de tareas |
| P2 | Google Calendar | **Parcial** (apagado por bandera) | Conector real `agenda/connectors/google.ts`; flag `AGENDA` (`agenda/flag.ts:40-42`); `AGENDA` ausente en `.env`; conector no está en `nav.ts` | Activar bandera + credenciales + OAuth con callback (hoy pegado manual) |
| P3 | Atribución de prospectos/campañas | **Parcial** | Captura `ctwa_clid` (`attribution/store.ts:15-49`), CAPI (`attribution/conversions.ts:44-139`); `attribution_event` **nunca se escribe** (`schema.ts:1860`) | Falta escribir first/last touch + UTMs; poblar `contact.acquisitionChannelId` |
| P4 | Rentabilidad por servicio/proyecto/campaña | **Parcial** | Fórmulas en `metrics/compute.ts:63-127`; `service_cost` existe (`schema.ts:1954-1979`) pero sin `catalogProductId` y sin margen por producto/proyecto/campaña; `campaign` y `campaign_insight` no se cruzan | Agrupar márgenes por dimensión; cruzar campaña planeada vs real |
| P5 | Dashboard estadístico por categorías | **Parcial** | Dashboard por CTE real (`dashboard/query.ts`); `queryCommercial` **ignora** filtros canal/campaña/servicio (`commercial/query.ts:18-26,68`) | Filtros reales + unificar con `metrics/catalog.ts` |
| P6 | Relaciones comerciales e historial | **Parcial** | `lead_contact_uq` único → **una oportunidad por contacto** (`schema.ts:259`); `activity_event` sin UI (`schema.ts:1907-1951`) | Multi-oportunidad + timeline |
| P7 | Medición de canales (Google Ads) | **Pendiente** | Solo prueba de conexión (`integrations/test-connection.ts:133-265`); sin `searchStream`/GAQL ni tabla | Módulo de lectura + sync + métricas |
| — | Módulo **Estrategias de Venta** | **Pendiente** | No hay tablas `strategy`/`goal`/`target` | Módulo nuevo reutilizando `campaign`/`offer`/`experiment`/`acquisition_channel` |

---

## Detalle por prioridad

### P1 — Cotización aceptada → proyecto automático
- El cotizador tiene estados reales incluido `accepted` (`quotes/service.ts:13-22`), aplicado solo desde `changeQuoteStatus` (`quotes/service.ts:475-545`), que hace: lock `FOR UPDATE`, valida transición, `UPDATE ... status='accepted'`, **descuenta stock** y emite webhook `quote.accepted`. **No crea proyecto, OS ni tareas.**
- El proyecto se crea **a mano** (`projects/service.ts:43-117`); siembra pasos de expediente (`project_step`), no tareas.
- Patrón de idempotencia reutilizable ya existente y **muerto**: `createChargeFromQuote` (`finances/service.ts:256`) con unique `charge_quote_uq` (`schema.ts:1356`).
- No existe entidad "orden de servicio" (0 coincidencias en `src/` y `drizzle/`).

### P2 — Google Calendar
- Integración **real y completa**, no un stub: refresh token (`google.ts:71-112`), `events.insert/get/patch/delete` (`google.ts:178-253`), Meet (`conferenceData`), sync unidireccional de tareas (`agenda/tasks-sync.ts`), anti-duplicados por `google_event_id` (`schema.ts:1149`, `1517`).
- **Apagada por diseño** (ADR-002): `agendaEnabled()` lee `AGENDA` (`agenda/flag.ts:40-42`); ausente en `.env`; todas las rutas devuelven 404.
- No hay OAuth authorization-code ni callback; es "pegar tokens" (`api/settings/google/route.ts`).
- Riesgo operativo documentado: app OAuth en modo prueba → Google revoca el refresh token a los 7 días.

### P3 / P6 — Atribución y relaciones
- Ejes existentes: `contact.source/medium/acquisitionChannelId` (`schema.ts:182-197`), `acquisition_channel` (16 canales, `lib/acquisition-channel.ts:40-57`), `ad_attribution` (Meta `ctwa_clid`).
- `attribution_event` (first/last touch, UTMs) modelado (`schema.ts:1851-1906`) y **leído** por dashboard/commercial, pero **sin ningún productor**.
- `ad_set`, `ad_creative`, `offer`, `sync_state` definidos **sin escritores**.
- `lead_contact_uq` impide múltiples oportunidades por contacto.

### P4 / P5 — Rentabilidad y dashboard
- `metrics/compute.ts` contiene todas las fórmulas (ROAS, ROMI, CAC, CPQL, contribución, margen) y `metrics/catalog.ts` declara el catálogo; el dashboard **reimplementa** KPIs en SQL (`dashboard/query.ts`) en vez de consumirlos.
- Margen hoy solo a nivel organización (`dashboard/query.ts:260-265`) y contribución comercial (`commercial/query.ts:247`).
- `campaign.budgetPlannedCents` (planeado) no se cruza con `campaign_insight.spendCents` (real) por `externalId`.

### P7 — Google Ads
- `IntegrationProvider` incluye `google_ads` (`integrations.ts:7`) y hay prueba de conexión con `listAccessibleCustomers` (`test-connection.ts:210-216`). No hay lectura de métricas, ni tabla, ni `MetricSource` de google_ads.

---

## Capacidades que NO se deben duplicar (reutilizar)

| Necesidad | Reutilizar |
|---|---|
| Experimentos A/B | `experiment` + `experiment_variant` + `experiment_observation` (`schema.ts:2006-2110`) |
| Costos de servicio | `service_cost` (`schema.ts:1954-1979`) |
| Atribución first/last touch | `attribution_event` (`schema.ts:1851-1906`) |
| Campañas/anuncios/ofertas | `campaign`, `ad_set`, `ad_creative`, `offer` (`schema.ts:1751-1848`) |
| Fórmulas | `metrics/compute.ts` + `metrics/catalog.ts` |
| Estado de sync | `sync_state` (`schema.ts:1982-2003`) |
| Partidas cotización→proyecto | `project_item` (mismo `unit_price` centavos que `quote_item`) |
| Workflow y plantillas | `project_stage`/`project_step`/`project_types.ts` |
| Navegación | `src/config/nav.ts` (fuente única de sidebar, breadcrumbs y ⌘K) |

Ver el inventario de código muerto y bugs en [`deuda-tecnica.md`](./deuda-tecnica.md) y el modelo de datos real en [`modelo-datos.md`](./modelo-datos.md).
