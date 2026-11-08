# 024 — Recepción durable de webhooks

**Carril:** ciclo completo (tabla multi-tenant y cambio en el contrato de ACK de Zernio WhatsApp).
**Estado:** diseño aprobado por el responsable el 2026-11-07; implementación en curso.

## Problema

Los webhooks de Meta y WAHA responden antes de terminar la ingesta y dependen de `after()`; si el proceso cae después del ACK, no hay fila pendiente desde la que recuperar el evento. Zernio WhatsApp procesa dentro de la petición y devuelve `503` si falla, por lo que mezcla la duración del proveedor con la de la ingesta.

## Comportamiento aceptado

1. Una entrega válida y autenticada se persiste en PostgreSQL, con su tenant y su payload de evento, **antes** de responder `200`.
2. Si no se puede persistir, la ruta devuelve un error reintentable (`503`); nunca acusa recibo de un evento que no quedó guardado.
3. Un worker in-process procesa eventos pendientes desde PostgreSQL; no se añade Redis, Temporal ni otra cola externa.
4. El estado es `pending`, `processed` o `failed`; una lease recuperable permite que otro ciclo reclame el trabajo tras un reinicio.
5. Se deduplica el sobre por `(organization_id, provider, idempotency_key)` y se conserva la deduplicación de mensajes por `wa_message_id`.
6. Meta WhatsApp, WAHA, Meta/Zernio Instagram, Meta/Zernio Messenger y Zernio WhatsApp pasan por la recepción durable. Un payload de Meta con varias cuentas se divide por tenant: no se copia el evento de otro negocio.
7. Eventos desconocidos, deshabilitados o sin tenant resoluble conservan el descarte actual; no se almacenan con `organization_id` nulo.
8. La firma y sus opciones actuales no cambian en esta entrega.
9. Los mensajes de Laboratorio (`is_test`) siguen protegidos por el sender existente y no alcanzan proveedores reales.

## Criterios de aceptación

- Una petición de prueba obtiene `200` solo después de que la fila `pending` sea visible en PostgreSQL.
- Fallo al insertar produce `503` y ninguna falsa confirmación.
- Reentregar el mismo sobre no crea otra fila; reentregar mensajes mantiene una sola fila por `wa_message_id`.
- Dos workers concurrentes no reclaman la misma fila (`FOR UPDATE SKIP LOCKED` + lease).
- Un fallo transitorio reprograma con backoff; al agotar intentos termina en `failed` con diagnóstico sin payload ni secretos en logs.
- Si se detiene el proceso después del ACK y antes de ejecutar el handler, el siguiente worker procesa el mensaje una sola vez.
- Los gates y el self-test E2E con WA/IA mocks pasan.

## Límites y decisiones

- El `200` de Zernio WhatsApp se emite tras persistir el evento; los fallos posteriores los gestiona la cola interna. Un fallo de persistencia devuelve `503`.
- El cuerpo crudo se guarda únicamente en el evento tenant-scoped. Al procesar correctamente se limpia el payload y se conserva un tombstone de deduplicación por 30 días; los eventos fallidos conservan su cuerpo hasta ese límite.
- La idempotencia externa es al menos una vez; los efectos de dominio siguen protegidos por la llave `wa_message_id` y por los guards existentes. Esta feature no promete transacciones distribuidas con Meta/Zernio/WAHA.
