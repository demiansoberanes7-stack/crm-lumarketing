# Prompt Maestro — Auditoría e Implementación de Analítica Comercial

> Copia/pega este prompt completo en una IA con acceso al repo. Está escrito para
> el CRM LUMARK (Next.js App Router + Drizzle + Recharts). Estándar: primero
> auditar, luego implementar por fases, siempre reutilizando lo que ya existe.

---

## 1. Rol y objetivo

Actúa como Ingeniero/a de Analítica y Product Analytics senior con dominio de
GA4 (Data API v1beta), Google Ads, Meta Ads, Google Search Console y modelos de
atribución. Tu objetivo es llevar la analítica comercial del CRM de un estado
"tablero de conteos" a un **sistema de decisión**: cada KPI responde una
pregunta de negocio, tiene fórmula explícita, fuente declarada y criterio de
"no disponible" cuando falte data. No inventes números: si la fuente no existe
o el denominador es 0, la métrica se reporta como *no disponible* con razón.

Alcance del trabajo: (a) auditar el código actual de analítica, (b) entregar la
matriz de KPIs y el resumen técnico, (c) implementar los KPIs faltantes por
fases, (d) validar con datos reales de producción.

## 2. Reglas de oro (inviolables)

1. **Reutilizar antes que crear**: el catálogo `METRIC_CATALOG` en
   `src/server/metrics/catalog.ts` y las fórmulas puras en
   `src/server/metrics/compute.ts` son la única fuente de verdad de KPIs.
   Nunca dupliques una métrica que ya existe; extiende el catálogo.
2. **Una fórmula, un lugar**: toda fórmula vive en `compute.ts` como función
   pura (sin BD, sin red). Los componentes solo formatean.
3. **Nada de promediar ratios**: para combinar períodos o segmentos, agrega
   numeradores y denominadores por separado y luego divide
   (ej. tasa global = Σconversiones ÷ Σsesiones; jamás promedio de tasas).
4. **Denominador 0 → `null`** con `availability: "unavailable"` y un motivo
   legible. Nunca devuelvas `0`, `NaN`, `Infinity` ni porcentajes inventados.
5. **Sin mezclar monedas**: nunca sumes MXN con USD; separa por `currency`.
6. **Sin doble conteo**: un contacto/conversión cuenta una vez por período;
   cuidado con joins que multiplican filas (campaign × contacto × evento).
7. **Transparencia de fuente**: toda tarjeta muestra su fuente
   (GA4, Google Ads, Meta Ads, CRM, Search Console, combinado) y su ventana.
8. **Ventanas explícitas**: toda métrica declara su rango (7/30/90 días o
   período del tablero) y es consistente entre número y rótulo (verificado
   con el bug histórico: la tarjeta "Errores — últimas 24 h" usaba el período
   completo).
9. **Costos reales**: cada reporte nuevo a GA4/Google Ads/Meta debe justificar
   su llamada; agrupa en un solo `runReport` lo que se pueda y conserva la
   caché existente.
10. **Accesibilidad y legibilidad**: formato es-MX, `tabular-nums` en cifras,
    etiquetas en español, estados vacíos con copy accionable.

## 3. Contexto del sistema (léelo antes de opinar)

- **Stack**: Next.js App Router (`src/app`), servidor en `src/server`,
  componentes en `src/components`, Drizzle + PostgreSQL, Recharts para gráficas,
  Tailwind con tokens en `src/app/globals.css` (acento white-label
  `--accent*`, neutros `--text-2/3`, estados con triada tint/soft/text).
- **Dashboard**: `GET /api/dashboard?period=` → `queryDashboard()` en
  `src/server/dashboard/query.ts` (CTEs SQL con caché 60 s) →
  `src/app/api/dashboard/route.ts` → `src/components/dashboard/dashboard-client.tsx`
  que agrupa tarjetas en `Department`s colapsables.
- **Analítica externa**: `GET /api/analytics/dashboard` → `readGa4Metrics()`
  en `src/server/analytics/ga4.ts` (REST Data API, JWT RS256, caché de tokens)
  → bloque `ga4` en `MarketingSection`.
- **Catálogo de métricas**: `METRIC_CATALOG` con `id, name, category, unit,
  formula, requires[], mayBeUnavailable` y `MetricSource`
  (`payment`, `campaign`, `ga4`, `lead_stage_event`, `attribution_event`, …).
- **Canales opcionales** (ADR-001): flag `CHANNELS` en env
  (`src/server/channels/enabled.ts`); WhatsApp/Zernio, Messenger, IG, TikTok,
  comentarios, Mercado Libre.

## 4. Fase 0 — Auditoría (obligatoria, primero)

Auditor **en este orden** y reporta hallazgos con `archivo:línea`:

1. `src/server/analytics/ga4.ts` — reports que pide, dimensiones, límites,
   manejo de errores/permisos, caché, si ya pide geografía (hoy: ciudad+región
   recién agregado).
2. `src/server/metrics/catalog.ts` + `compute.ts` — KPIs registrados vs.
   fórmulas implementadas; detecta huérfanos (en catálogo sin fórmula) y
   fórmulas sin catálogo.
3. `src/server/dashboard/metrics.ts` y `src/server/dashboard/query.ts` —
   qué cuenta el tablero hoy, ventanas usadas vs. rótulos, CTEs costosos.
4. `src/app/api/analytics/dashboard/route.ts` y
   `src/app/api/analytics/ga4/test/route.ts` — contrato, estados de conexión,
   tolerancia a fallos.
5. `src/app/api/ads/campaigns/route.ts` — qué expone Meta/Google Ads.
6. `src/components/dashboard/{marketing-section,ads-section,campaign-explorer,dashboard-client}.tsx`
   — qué se muestra, duplicidades, estados vacíos.
7. Search Console: **no existe** — confírmalo e inclúyelo como brecha.

Entrega de la auditoría: **matriz de KPIs** (id, nombre, fórmula, fuente,
ventana, estado: existente / faltante / roto) y **resumen técnico** (top 10
hallazgos con archivo:línea y severidad).

## 5. KPIs nuevos requeridos (agrega al catálogo, no los pintes a mano)

### 5.1 Search Console (orgánico)
- `organic_impressions`, `organic_clicks`, `organic_ctr` (cliks ÷ impresiones),
  `organic_avg_position` (promedio ponderado por impresiones), y
  `top_queries` (top 10 por clics con posición).
- Fuente nueva `search_console` en `MetricSource`; consumir Search Console API
  `searchanalytics.query` con el mismo patrón de credenciales que GA4.

### 5.2 Google Ads
- `google_ads_spend`, `google_ads_clicks`, `google_ads_cpc`,
  `google_ads_conversions`, `google_ads_conversion_rate`,
  `google_ads_cost_per_conversion`.
- Si ya hay datos en `campaign` (BD), declararlos con `requires: ["campaign"]`.

### 5.3 Meta Ads
- `meta_spend`, `meta_reach` (si está disponible), `meta_ctr`,
  `meta_cost_per_result`, `meta_results`.
- Reutilizar lo que ya trae `campaign-explorer.tsx`; no dupliques fetch.

### 5.4 GA4 ampliado
- `engaged_sessions`, `avg_session_duration`, `events_per_session`,
  `conversions_ga4` (eventos `generate_lead`/`purchase`), `landing_pages`
  (top 10 sesiones), `device_split`, `cities` (recién agregado).
- Agregar 4ª/5ª llamada al `Promise.all` de `readGa4Metrics` respetando
  límites (`limit`) y tolerancia: si un reporte falla, el resto responde.

### 5.5 KPIs combinados GA4 + CRM (el corazón del sistema)
- `cpql` — **Costo por Qualified Lead** = inversión ÷ leads calificados.
- `cac_pagador` — **CAC pagador** = inversión ÷ clientes con pago en el período
  (≠ CAC por lead: usar `payment`, no `lead_stage_event`).
- `session_to_lead` (existe) + `lead_to_qualified` (existe): encadenar como
  **embudo sesión → lead → calificado → cotizado → ganado → cobrado**, con
  tasas por paso agregadas (regla 3).
- `pipeline_value` — valor abierto por etapa (Σ deals abiertos × monto).
- `loss_by_reason` — motivos de pérdida con % sobre total de perdidos
  (ya existe `lossByReason` en UI; registrarlo en catálogo).
- `time_to_close` — días mediana (no media) desde creación hasta won.

### 5.6 Experimentos A/B
- Reusar `experiment_lift` de `compute.ts`; exigir muestra mínima y evidencia
  (`evidenceStatus`); marcar "insuficiente" si n < umbral, nunca "ganador".

## 6. Sección "Posicionamiento orgánico vs. pagado"

Nueva tarjeta/sección comparativa en el dashboard (Marketing):
- Orgánico: sesiones + impresiones/clics Search Console.
- Pagado: inversión + clics/conversiones Meta + Google Ads.
- Ratios comparados con regla 3: CTR orgánico vs. CTR pagado, CPC pagado vs.
  "costo orgánico implícito" (solo si se puede justificar; si no, omítelo).
- Gráfica: barras dobles orgánico/pagado por período (Recharts, patrón
  existente en `charts.tsx`), colores `--chart-*` de los tokens.
- Estado vacío si ninguna fuente conectada: banner ámbar patrón
  `campaign-explorer.tsx`.

## 7. Reglas de agregación (formalizadas)

```
tasa(A,B) = ΣA ÷ ΣB                     // jamás Σ( Ai ÷ Bi ) ÷ n
ventana(t) = [from, to] declarados       // rótulo y query idénticos
moneda(c)  = agrupa por c                // nunca Σ de divisas distintas
cero       = denominador 0 → null        // availability="unavailable" + motivo
doble      = claves únicas por (id, período)
```
Implementar como helpers en `compute.ts` (`safeDivide` ya existe; añadir
`aggregateRate(rows)` si hace falta) y **tester cada helper**.

## 8. Contrato de datos y estados

Todo endpoint de analítica responde con:
`{ data, sources: [{name, status}], window, generatedAt }`.
Estados por fuente: `disconnected | configured | connected | error` + `message`.
Errores de API nunca rompen el dashboard: degradan la fuente a `error` y el
resto responde (patrón ya usado en `analytics/dashboard/route.ts`).

## 9. Stack de UI y convenciones

- Envolver gráficas en `ChartCard` (`src/components/dashboard/chart-card.tsx`).
- Recharts vía `src/components/dashboard/charts.tsx` (`HorizontalBarChart`,
  `LineChartCard`, `PieChartCard`, `FunnelChart`…); no importes Recharts
  directamente si la plantilla ya existe.
- KPIs en `KpiCard` con `formatNumber/formatCurrency/formatPercent`.
- Badge de origen por métrica (`metric-badge.tsx`) mostrando fuente y ventana.
- Estados vacíos: serif itálica + copy accionable + link a
  `/settings/marketing` si la fuente está desconectada.
- Tokens: nada de `bg-brand/20` (Tailwind 3 descarta opacidad sobre vars);
  usar `--accent-tint/soft/text`.
- Responsive: grid `sm:grid-cols-2 lg:grid-cols-4` para KPIs, `lg:grid-cols-2`
  para gráficas.

## 10. Orden de implementación por fases

**Fase 1 — Cimientos**: matriz de KPIs + helpers de agregación + tests de
`compute.ts`. Sin UI nueva.
**Fase 2 — GA4 ampliado**: reports nuevos en `readGa4Metrics`, tarjetas de
engagement/landing/device/ciudades.
**Fase 3 — Google Ads + Meta Ads**: KPIs de pago y CPC/CPA, consolidación con
`campaign-explorer` (sin doble fetch).
**Fase 4 — Combinados GA4+CRM**: CPQL, CAC pagador, embudo completo,
pipeline, motivos de pérdida, time_to_close.
**Fase 5 — Search Console**: integración nueva, tarjeta orgánica, sección
orgánico vs. pagado.
**Fase 6 — A/B**: experimentos con evidencia y umbrales.

Cada fase: código + tests + gates + deploy; no desplegar fases a medias.

## 11. Datos reales (aceptación)

- Conexión real: GA4 `propertyId` de producción, service account con rol
  "Observador de datos"; Google Ads/Meta con tokens vigentes; Search Console
  con propiedad `https://crm.lumarketing.digital` (o dominio del cliente).
- Prueba mínima: `POST /api/analytics/ga4/test` devuelve `ok` con conteo de
  sesiones; `/api/analytics/dashboard` responde `ga4` no nulo.
- Verificación por KPI: contrasta contra la UI nativa de la fuente
  (GA4/Ads/Meta/GSC) con tolerancia ≤ 2% por diferencias de ventana/timezone.

## 12. Rendimiento y límites

- Máximo **5 llamadas** paralelas por request de dashboard; `limit` explícito
  en cada reporte; caché 60 s del lado CRM.
- Reportes por rango fijo (30 días) salvo que la UI pida período; si pide
  período, propagar `from/to` desde el query param `period`.
- Presupuesto de latencia: `/api/dashboard` < 2 s con caché fría.

## 13. Seguridad y privacidad

- Credenciales solo en integraciones de BD cifradas (`getIntegration`) o env;
  jamás en respuestas de API o logs.
- Sin PII en gráficas agregadas: ciudades/queries son agregados; nada de
  teléfonos/correos en analítica.
- Webhooks/error messages: no filtrar tokens ni trazas internas al cliente.

## 14. Tests exigidos

- Unit: cada fórmula nueva en `compute.ts` (feliz/0/null/moneda/muestra chica).
- Unit: catálogo — todo `id` tiene fórmula y viceversa (guard contra huérfanos).
- Unit: `readGa4Metrics` con `fetch` mockeado (patrón de
  `tests/unit/ga4.test.ts`) para cada reporte nuevo.
- Route: estado `error` de fuente no rompe el dashboard.
- No regressión: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.

## 15. Definición de "done" por KPI

- [ ] Entrada en `METRIC_CATALOG` con fórmula y `requires`.
- [ ] Fórmula en `compute.ts` (pura) + tests.
- [ ] Fuente conectada y degradando bien si falla.
- [ ] UI con `KpiCard`/gráfica, fuente + ventana visibles.
- [ ] Estado vacío y "no disponible" implementados.
- [ ] Validado contra datos reales (≤ 2% vs. UI nativa).

## 16. Salidas que debes entregar

1. **Matriz de KPIs** (tabla completa: id, nombre, fórmula, fuente, ventana,
   fase, estado).
2. **Resumen técnico** (hallazgos de auditoría con `archivo:línea`, severidad,
   esfuerzo).
3. **Gap list** (qué falta construir vs. qué existe).
4. **Plan de fases** con estimación y orden de despliegue.
5. Tras implementar: **diff por fase** con gates corridos y verificación en
   producción (`/api/health` → commit).

## 17. Qué NO hacer

- No crear un "nuevo dashboard" paralelo: extiende el actual.
- No agregar dependencias pesadas (librerías de mapas, tablas nuevas) sin
  justificar; Recharts ya cubre las gráficas.
- No tocar la paleta de tokens salvo que se pida (sistema white-label).
- No prometer métricas cuya fuente no está conectada: se marca
  "no disponible — fuente no conectada".
- No implementar varias fases en un solo commit sin gates.

## 18. Preguntas de negocio que el tablero debe responder

1. ¿Cuánto cuesta adquirir un cliente que paga? (CAC pagador)
2. ¿Cuánto cuesta un lead calificado? (CPQL)
3. ¿De dónde vienen los clientes que pagan: orgánico o pagado?
4. ¿En qué paso del embudo se pierde más? (embudo + motivos de pérdida)
5. ¿Qué ciudades/queries traen tráfico que convierte?
6. ¿Qué campaña tiene mejor ROAS real (con pagos, no con clics)?
7. ¿Cuánto pipeline está abierto y cuándo se cierra? (pipeline, time_to_close)

Cada KPI nuevo debe cobrir al menos una de estas preguntas; si no, no entra.

## 19. Criterios de calidad del código

- TypeScript estricto, sin `any` en contratos públicos.
- Español en UI y en mensajes de error; inglés en identificadores.
- Comentarios solo donde hayan decisiones no obvias (por qué, no qué).
- Convención del repo: rutas `route.ts` con `withAuth`, queries con
  `scoped(organizationId, …)`, migraciones manuales idempotentes en
  `drizzle/NNNN_*.sql` (nada de `drizzle-kit generate`, snapshot corrupto).

## 20. Checklist final antes de declarar terminado

- [ ] Auditoría entregada con matriz de KPIs y resumen técnico.
- [ ] Todas las fases del §10 implementadas o explicitadamente pospuestas.
- [ ] Reglas del §7 cumplidas en cada métrica (sin promediar ratios, etc.).
- [ ] Estados de fuente y degradación verificados (simular sin credenciales).
- [ ] Datos reales contrastados (≤ 2% vs. UI nativa de cada fuente).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.
- [ ] Commit + push + CI verde + deploy verificado: `/api/health` →
      `{ ok, commit }` coincide con el commit local.
- [ ] Documentación: matrix de KPIs actualizada en
      `docs/DOCUMENTACION-COMPLETA-SISTEMA.md`.
