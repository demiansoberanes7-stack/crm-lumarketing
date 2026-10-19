/**
 * 017 — Estado en memoria del mock de Zernio (solo dev/test). Vive en
 * globalThis porque Next recarga módulos en dev; una instancia = un proceso,
 * así que el outbox en memoria alcanza para las aserciones del self-test.
 */

export type ZernioSentMessage = {
  n: number;
  conversationId: string;
  accountId: string | null;
  message: string;
  /** Presente solo fuera de la ventana de 24 h. */
  messagingType?: string;
  messageTag?: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentUrl?: string;
  attachmentSize?: number;
  /** Llave de idempotencia con la que llegó, si la hubo. */
  idempotencyKey: string | null;
  at: string;
};

export type ZernioCommentReply = {
  n: number;
  postId: string;
  commentId: string | null;
  accountId: string | null;
  message: string;
  idempotencyKey: string | null;
  at: string;
};

type ZernioMockState = {
  seq: number;
  sent: ZernioSentMessage[];
  commentReplies: ZernioCommentReply[];
};

const g = globalThis as unknown as { __zorroZernioMock?: ZernioMockState };

export function zernioMockState(): ZernioMockState {
  if (!g.__zorroZernioMock) g.__zorroZernioMock = { seq: 0, sent: [], commentReplies: [] };
  g.__zorroZernioMock.commentReplies ??= [];
  return g.__zorroZernioMock;
}

/** Vacía lo enviado. El contador NO se reinicia: ver `nextZernioMessageId`. */
export function resetZernioMock(): void {
  zernioMockState().sent = [];
  zernioMockState().commentReplies = [];
}

/**
 * Id del mensaje que el mock le devuelve al CRM.
 *
 * Lleva la marca de tiempo del proceso, no solo un contador: el CRM guarda ese
 * id con un índice ÚNICO, así que dos corridas del arnés contra la misma base
 * chocarían con `zmock_1` y el envío fallaría por una colisión del harness,
 * que se ve igual que un bug del producto.
 */
export function nextZernioMessageId(): string {
  const state = zernioMockState();
  return `zmock_${Date.now().toString(36)}_${++state.seq}`;
}

/**
 * Una llave que termina en `-invalid` se rechaza, igual que hace el mock de
 * Graph: es como el arnés comprueba que unas credenciales malas NO se guardan.
 */
export function zernioTokenIsBad(authorization: string | null): boolean {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return token.length === 0 || token.endsWith("-invalid");
}
