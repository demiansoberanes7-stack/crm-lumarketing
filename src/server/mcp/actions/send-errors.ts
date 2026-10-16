import { describeSendErrorText } from "@/lib/meta/send-errors";

/**
 * Error de envío listo para el LLM: conserva la traducción accionable de Meta
 * y convierte el caso típico de ventana cerrada en una instrucción clara.
 * Los SendError de la inbox ya traen mensajes en español; solo se traduce lo
 * que Meta manda crudo.
 */
export function sendActionError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/window_closed/i.test(raw)) {
    return new Error(
      "La ventana de respuesta está cerrada: pide al cliente que responda un mensaje antes de volver a enviar."
    );
  }
  return new Error(describeSendErrorText(raw));
}
