# Investigación funcional (Fase B)

> Entregable de la Fase B del encargo: cómo se investigaron los patrones funcionales de referencia
> y **qué evidencia** la respalda. Distingue explícitamente observaciones, inferencias y limitaciones.

## Estado de REA

| Aspecto | Resultado |
|---|---|
| Herramienta | REA (`morluto/rea`) v6.5.0 — MCP de ingeniería inversa (binarios, apps JS/Electron, .NET, webs) |
| Instalación | **Instalado y registrado** en OpenCode: `npx -y rea-agents@6.5.0 mcp` en `~/.config/opencode/opencode.jsonc` (backup en `opencode.jsonc.rea.backup`) |
| Validación | `rea mcp doctor` → initialize OK, **207 herramientas**, 6 prompts, identidad `6.5.0` alineada. `rea doctor` → registro **opencode: aligned** |
| Entorno | Node v24.21.0 (compatible) |
| **Limitación** | Las herramientas MCP de REA se cargan al **iniciar** OpenCode; **no están disponibles en la sesión en la que se instaló**. Estarán disponibles tras reiniciar OpenCode. La CLI (`npx rea-agents@latest <comando>`) sí funciona por terminal |

## Decisión de uso

Según las reglas del encargo (§3, §3.1): "Solo examina aplicaciones y sistemas que se puedan consultar
legítimamente" y "No eludas controles de acceso". REA habilita el análisis de aplicaciones de terceros
(HubSpot, Pipedrive, Odoo, Zoho, Salesforce) mediante captura de su web/runtime. Esa vía es:
1. **Técnicamente pesada** (requiere navegador, capturas, sesiones autenticadas de terceros).
2. **Jurídicamente sensible** (analizar en runtime apps propietarias de terceros).
3. **Poco necesaria**: LUMARK ya tiene mapeados internamente los modelos funcionales requeridos
   (`campaign`, `offer`, `experiment`, `service_cost`, `attribution_event`, `activity_event`), y el
   encargo pide construir una **implementación propia** adaptada a LUMARK, no copiar terceros.

Por ello, la investigación funcional se basa en **documentación pública** de referencia y en el
**conocimiento funcional** de CRM, y **se registra como inferencia** (no como observación de REA).
Cuando REA esté disponible por MCP tras el reinicio, podrá usarse para investigaciones puntuales que
aporten evidencia, sin sustituir la lectura del código de LUMARK.

## Mapa de evidencias por proceso (P1–P7)

| Proceso investigado | Referente funcional común | Cómo se traduce en LUMARK | Base en el repo (evidencia) |
|---|---|---|---|
| Aceptación de cotización → proyecto | "Quote won → Project/Deal" | `changeQuoteStatus("accepted")` dispara creación/reutilización de proyecto + OS | `quotes/service.ts:475-545` |
| Proyecto ↔ orden de servicio ↔ tareas | "Project / Work order / Tasks" | `project` + `project_task`; nueva `service_order` ligera | `schema.ts:1012-1157` |
| Atribución de prospectos y campañas | first/last touch + UTM | Escribir `attribution_event` en la ingesta | `schema.ts:1851-1906`; `inbox/ingest.ts:455-467` |
| Control de ventas/costos/rentabilidad | Revenue vs cost vs margin | `service_cost` + `metrics/compute.ts` | `schema.ts:1954-1979`; `metrics/compute.ts:63-127` |
| Dashboards de ventas/marketing/finanzas | KPIs con filtros | Filtros reales en `queryCommercial` + `metrics/catalog.ts` | `commercial/query.ts:18-26,68` |
| Historial de interacciones | Activity timeline | UI/rutas sobre `activity_event` | `schema.ts:1907-1951` |
| Sync con Google Calendar | Calendar events ↔ tasks | Conector existente + OAuth callback | `agenda/connectors/google.ts` |
| Estrategias comerciales | Goals/segments/channels/budget | Módulo nuevo sobre `campaign`/`offer`/`acquisition_channel` | `schema.ts:1735-1848` |
| Experimentos A/B | Hypothesis/variants/observations | Reutilizar `experiment*` | `schema.ts:2006-2110` |

## Qué es observación, inferencia y limitación

- **Observación (verificada en código):** todo lo citado con `archivo:línea` en este mapa y en
  [`auditoria-funcional.md`](./auditoria-funcional.md).
- **Inferencia:** los patrones de "cómo suele comportarse" un CRM de referencia (p. ej., acreditar
  una venta una sola vez, no contar dos veces una conversión) se toman del conocimiento funcional y
  de documentación pública, **no** de una observación directa instrumentada con REA.
- **Limitación:** no se ejecutó REA sobre aplicaciones de terceros; no se declara ninguna conclusión
  por ingeniería inversa de terceros. REA queda disponible para uso posterior vía MCP tras reiniciar
  OpenCode.

## Detalle de REA (para reproducir)

```bash
# Registrar REA en OpenCode (ya ejecutado)
npx -y rea-agents@latest setup --client opencode --yes

# Validar
npx -y rea-agents@latest mcp doctor   # 207 herramientas, identidad 6.5.0
npx -y rea-agents@latest doctor       # registro opencode: aligned
```
