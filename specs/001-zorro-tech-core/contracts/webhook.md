# Contrato: Webhook de WhatsApp Cloud API

Ruta: `/api/webhooks/wa/[webhookToken]` — `[webhookToken]` DEBE igualar
`META_WEBHOOK_VERIFY_TOKEN` (comparación timing-safe). Segmento incorrecto → **404**
sin efectos (GET y POST). Ruta `force-dynamic`.

> El `META_WEBHOOK_VERIFY_TOKEN` es **de instancia**, no por organización: quien lo
> conoce puede entregar eventos de cualquier WABA conectada a la app de Meta de este
> despliegue. La separación real entre tenants depende de la firma (`META_APP_SECRET`)
> y del ruteo por `phone_number_id`. En WAHA sí hay identidad por tenant porque el
> segmento es `HMAC("waha:" + organizationId)` → ver `docs/SISTEMA-COMPLETO.md` §28.

## GET (handshake de verificación)

Query: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.

- `hub.verify_token` == `META_WEBHOOK_VERIFY_TOKEN` y segmento correcto → `200` con
  body = `hub.challenge` (texto plano).
- Cualquier otro caso → `403` (segmento incorrecto → `404`).

## POST (eventos)

1. **Capa 1**: segmento ≠ token → `404` (sin leer el body).
2. **Rate limit**: `checkDistributedRateLimit("webhook:wa:{token}:{ip}",
   WEBHOOK_RATE_LIMIT)` → excedido = `429`.
3. **Body**: `readLimitedBody(req, 2_000_000)` → más de 2 MB = `413`.
4. **Capa 2** (solo si `META_APP_SECRET` configurado): validar
   `x-hub-signature-256: sha256=<hmac>` = HMAC-SHA256(app_secret, raw body). Inválida o
   ausente → `401`.
5. Responder `200 {"received":true}` SIEMPRE tras encolar/procesar — nunca 5xx por
   errores de dominio (Meta reintenta y desactiva webhooks que fallan). Un body que no
   es JSON válido también devuelve `200` y se descarta.

`META_APP_SECRET` ausente ⇒ la capa 2 se omite **por diseño** (no es fail-open
accidental: si el secreto falta, ninguna firma —incluida la correcta— podría validarse y
fail-closed cortaría todo el tráfico). La primera llamada que pasa por ahí deja en los
logs una única advertencia
(`[webhook] META_APP_SECRET no está configurado: las firmas de Meta se aceptan sin verificar.`)
para que el despliegue quede visible. Ponerlo es responsabilidad del operador →
`docs/SISTEMA-COMPLETO.md` §25 y §28.

### Payload (subset procesado)

```jsonc
{ "object": "whatsapp_business_account",
  "entry": [{ "id": "<WABA_ID>", "changes": [{
    "field": "messages",            // o "smb_message_echoes"; "message_template_status_update" se ignora
    "value": {
      "metadata": { "phone_number_id": "...", "display_phone_number": "..." },
      "contacts": [{ "wa_id": "5215512345678", "profile": { "name": "..." } }],
      "messages": [{ "id": "wamid....", "from": "5215512345678",
                     "timestamp": "1720000000", "type": "text",
                     "text": { "body": "..." } }],
      "statuses": [{ "id": "wamid....", "status": "sent|delivered|read|failed",
                     "timestamp": "...", "errors": [{ "code": 131047, "title": "..." }] }]
    } }] }] }
```

Reglas de procesamiento (solo `field: "messages"` y `"smb_message_echoes"`; cualquier
otro field se ignora sin error):

- Ruteo por `metadata.phone_number_id` → `meta_credentials.phone_number_id` → org. Sin
  match → `200` e ignorar.
- `messages[]` → ingesta idempotente (`wa_message_id` UNIQUE; duplicado → no-op).
  Tipos no-texto → mensaje con `type` correspondiente y body NULL (chip). Tipos
  desconocidos → `unsupported`, sin error.
- `statuses[]` → upgrade monotónico del estado (`sent<delivered<read`; nunca degradar;
  `failed` registra `error_detail`).
- `smb_message_echoes[]` (coexistence: mensajes escritos desde la app del teléfono) →
  misma idempotencia por `wa_message_id`, sin inserción ni handoff duplicado
  (`src/server/inbox/ingest.ts:303`).
- Tras ingesta: emitir evento SSE y disparar pipeline del agente (si aplica).

> **Divergencia entre contrato e implementación (verificada 2026-10-19).** El evento
> `field: "message_template_status_update"` (Meta notifica `APPROVED`/`REJECTED`/`PENDING`
> de una plantilla) está declarado aquí pero **no se procesa**: la ruta solo maneja
> `messages` y `smb_message_echoes` (`src/app/api/webhooks/wa/[webhookToken]/route.ts:91-96`).
> La razón es una decisión de producto, no un olvido: la US6 de plantillas se borró en
> `630d1c6` (2026-10-01) con `drizzle/0021_drop_template.sql` → `DROP TABLE "template"`, y
> su comentario deja el CRM **reactivo**: «sin plantillas el envío proactive no existe; el
> CRM solo responde dentro de la ventana de 24 h». `specs/001-vocero-core/tasks.md`
> (T081-T086) sigue marcándola `[X]` como registro histórico.
>
> Consecuencias actuales: no hay tabla de plantillas ni sincronización, y
> `template_name`/`template_language`/`template_params` de `broadcast_campaign`
> (`src/lib/db/schema.ts:2412-2414`) son columnas inertes que ningún código escribe.
> Reactivar la US6 requiere tabla + rutas `/api/templates*`, procesamiento del field
> (enrutando por `entry[].id` = WABA, no por `phone_number_id`), suscripción del field en
> el panel de Meta y envío con `components`. Ver `docs/deuda-tecnica.md` §6.
