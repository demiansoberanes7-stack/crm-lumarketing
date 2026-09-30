import { mockGuard } from "@/lib/dev-guard";
import {
  clearSink,
  getSinkEntries,
  recordSinkEntry,
} from "@/server/dev/webhook-sink-state";

export const dynamic = "force-dynamic";

/**
 * Sink de webhooks de salida — solo con mocks activos (404 en producción, el
 * mismo gate que `wa-mock`).
 *
 * El CRM se apunta a sí mismo cuando el E2E quiere comprobar que un evento
 * dispara una entrega firmada de verdad, no solo que la fila se escribió.
 * La firma no se verifica aquí: el que la comprueba es el guión, con el secreto
 * que él mismo configuró (es el receptor real de la historia).
 */

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const raw = await req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw: raw.slice(0, 2000) };
  }

  const entry = recordSinkEntry({
    event:
      typeof parsed === "object" && parsed !== null && "event" in parsed
        ? String((parsed as { event: unknown }).event)
        : "(sin evento)",
    signature: req.headers.get("x-webhook-signature"),
    deliveryId: req.headers.get("x-webhook-delivery"),
    idempotencyKey: req.headers.get("idempotency-key"),
    payload: parsed,
    raw,
  });

  return Response.json({ ok: true, n: entry.n });
}

export function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ received: getSinkEntries() });
}

export function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  clearSink();
  return Response.json({ cleared: true });
}
