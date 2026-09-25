import { requireSession, UnauthorizedError } from "@/lib/auth/session";
import { subscribe } from "@/server/events/bus";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const MAX_SSE_CONNECTIONS = 5;
const encoder = new TextEncoder();

/** Active SSE connections per org — to enforce the concurrency limit */
const activeConnections = new Map<string, number>();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    throw err;
  }
  const { organizationId } = session;

  const current = activeConnections.get(organizationId) ?? 0;
  if (current >= MAX_SSE_CONNECTIONS) {
    return Response.json(
      { error: { code: "too_many_connections", message: `Maximo ${MAX_SSE_CONNECTIONS} conexiones SSE por organizacion` } },
      { status: 429 }
    );
  }
  activeConnections.set(organizationId, current + 1);

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      const unsubscribe = subscribe(organizationId, (event) => {
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        const c = activeConnections.get(organizationId) ?? 1;
        if (c <= 1) activeConnections.delete(organizationId);
        else activeConnections.set(organizationId, c - 1);
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
