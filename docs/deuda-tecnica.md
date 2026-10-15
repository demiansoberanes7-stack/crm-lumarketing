# Deuda técnica — LUMARK CRM

> Inventario de código muerto, funcionalidad no operativa y bugs detectados durante la auditoría
> sobre el commit base `5ce91e2`. Cada hallazgo está referenciado a `archivo:línea`.
> Este documento se actualiza en cada fase del proyecto.

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
