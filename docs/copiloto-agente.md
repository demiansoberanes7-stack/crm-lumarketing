# Copiloto y Agente: las dos superficies de IA

El CRM tiene **dos IAs distintas** con contratos distintos. No se confunden, no
comparten configuración y no comparten permisos:

| | **Copiloto** | **Agente** |
|---|---|---|
| Para qué | Consultar el negocio en lenguaje natural | Vender en la Bandeja (responder conversaciones) |
| Dónde | `/copiloto` (sidebar) | Conversaciones de la Bandeja, con `ai_enabled` |
| Acciones de escritura | **Ninguna** — solo lee | Responder, mover etapas, reservar citas, cotizar, handoff |
| Configuración | Ajustes → Copiloto (solo owner) | Ajustes → Agente (solo owner) + variables de entorno |
| Contexto | Fuentes seleccionadas por el owner, del tenant | KB + perfil + etapas + catálogo, de la conversación |

## Copiloto (consulta de solo lectura)

Responde preguntas sobre los datos del negocio ("¿cuánto cobramos este mes?",
"¿qué citas hay mañana?") sin tocar nada. Su valor es que **nunca** muta estado:
no envía mensajes, no mueve etapas, no crea cotizaciones.

- **Configuración** (`src/lib/copilot-config.ts`, tabla `copilot_settings`):
  el owner elige entre fuentes habilitadas (métricas, pipeline, contactos,
  conversaciones, notas, cotizaciones, finanzas, agenda, proyectos, estado de
  conexiones, guía del sistema) o deja el modo "todas".
- **Contexto** (`src/server/copilot-context.ts`): cada consulta arma un contexto
  con **solo las fuentes habilitadas**, siempre acotado al tenant
  (`scoped()`), y con **datos personales redactados** (correos y teléfonos) en
  los bloques de conversaciones/notas. Una fuente que falla se marca
  "no disponible" y el modelo no debe inferir con ella.
- **Historial**: cada pregunta/respuesta queda en `watsi_message` con su
  `sources` (qué fuentes se usaron), accesible desde `/copiloto`.
- **Superficie**: `/api/copilot/*` con `withOwner` en la configuración; el chat
  exige sesión y ownership de la organización (404 en otra org).

## Agente (comercial, en la Bandeja)

El agente conversa con contactos reales y **sí actúa**: responde, actualiza el
lead, mueve de etapa, ofrece y reserva slots, hace handoff a humano, **consulta
el inventario** (`search_inventory`, con IDs, precios y existencias reales) y
puede **crear y enviar cotizaciones** de uno o varios productos
(`create_quote`/`send_quote`) con idempotencia por mensaje y gate
`sendProductQuotes`. Su prompt y acciones viven en
`src/server/ai/prompts.ts` y `src/server/ai/actions.ts`; la ejecución, en
`src/server/ai/pipeline.ts` y la búsqueda de inventario en
`src/server/ai/inventory.ts`. Su autoevaluación corre en el Laboratorio.

La configuración del Agente (perfil, tono, instrucciones, saludo, reglas, KB)
sigue en Ajustes → Agente y no se movió: el Copiloto **no** la reemplaza ni la
lee.

## Por qué están separados

- **Superficie de riesgo**: un asistente de consulta no debe poder escribir en
  producción; las acciones del Agente pasan por gates (ventana de 24h, handoff,
  sandbox `is_test`, moneda, catálogo).
- **Contexto distinto**: el Copiloto resume el negocio agregado; el Agente ve
  una conversación concreta y decide el siguiente paso comercial.
- **Configuración independiente**: afinar el tono del Agente no cambia cómo el
  Copiloto responde un KPI, y viceversa.

## Archivos clave

| Qué | Dónde |
|---|---|
| Fuentes y defaults del Copiloto | `src/lib/copilot-config.ts` |
| Contexto acotado + redacción | `src/server/copilot-context.ts` |
| Config (API, owner-only) | `src/app/api/copilot/settings/route.ts` |
| UI de ajustes | `src/app/(app)/settings/copiloto/` |
| Chat | `src/app/(app)/copiloto/` |
| Migraciones | `drizzle/0051_copilot_settings.sql`, `drizzle/0052_watsi_message_sources.sql` |
| Prompt y acciones del Agente | `src/server/ai/prompts.ts`, `src/server/ai/actions.ts`, `src/server/ai/pipeline.ts` |
