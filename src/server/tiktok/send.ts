import { MetaApiError } from "@/lib/meta/client";
import type { TikTokCredentials } from "@/server/tiktok/credentials";
import { sendZernioMessage } from "@/server/zernio";

/**
 * Frontera de salida del canal de TikTok.
 *
 * TikTok DMs solo se envían por Zernio. La API de TikTok no permite
 * mensajes fríos: solo se puede responder a mensajes recibidos.
 */

export type TikTokSendResult = { platformMessageId: string };

/**
 * Envía texto por TikTok via Zernio.
 *
 * `recipient` es el TikTok Open ID; `threadRef` es el conversationId opaco
 * de Zernio necesario para enrutar la respuesta.
 */
export async function sendTikTokText(input: {
  credentials: TikTokCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  humanAgentTag?: boolean;
  idempotencyKey?: string;
}): Promise<TikTokSendResult> {
  return sendZernioMessage({
    token: input.credentials.token,
    accountId: input.credentials.accountRef,
    conversationId: input.threadRef,
    text: input.text,
    humanAgentTag: input.humanAgentTag,
    idempotencyKey: input.idempotencyKey,
  });
}
