import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { applyStatusUpdate } from "@/server/inbox/status";
import { normalizeMx } from "@/lib/meta/client";
import { whatsappProvider } from "./provider";
import type { WhatsappZernioCredentials } from "./zernio-credentials";

export const whatsappZernioEvent = z.object({
  event: z.string(),
  account: z.object({ id: z.string().optional(), accountId: z.string().optional(), platform: z.literal("whatsapp") }),
  metadata: z.object({ standby: z.boolean().optional() }).passthrough().nullish(),
  message: z.object({
    id: z.string().optional(), platformMessageId: z.string().min(1), conversationId: z.string().min(1),
    direction: z.enum(["incoming", "outgoing"]), text: z.string().nullish(), sentAt: z.string().datetime({ offset: true }),
    sender: z.object({ id: z.string(), name: z.string().nullish(), phoneNumber: z.string().nullish(), businessScopedUserId: z.string().optional() }).optional(),
    attachments: z.array(z.object({ type: z.string(), url: z.string().optional(), payload: z.object({ id: z.string().optional(), mime_type: z.string().optional(), filename: z.string().optional() }).passthrough().optional() })).optional(),
  }),
});
export function validWhatsappZernioSignature(raw: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const actual = signature.replace(/^sha256=/, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
export function whatsappZernioIdentity(sender: NonNullable<z.infer<typeof whatsappZernioEvent>["message"]["sender"]>) {
  const waUserId = sender.businessScopedUserId ?? null;
  const phone = sender.phoneNumber ? normalizeMx(sender.phoneNumber.replace(/\D/g, "")) : !waUserId && /^\+?\d{7,15}$/.test(sender.id) ? normalizeMx(sender.id.replace(/\D/g, "")) : null;
  if (!phone && !waUserId) throw new Error("Identidad WhatsApp no disponible");
  return { identity: phone ?? `bsuid:${waUserId}`, channel: "whatsapp" as const, phone, waUserId, profileName: sender.name ?? null };
}
export async function ingestWhatsappZernio(event: z.infer<typeof whatsappZernioEvent>, creds: WhatsappZernioCredentials) {
  const msg = event.message;
  const status = ({ "message.sent": "sent", "message.delivered": "delivered", "message.read": "read", "message.failed": "failed" } as Record<string, string>)[event.event];
  if (status && msg.direction === "outgoing") {
    await applyStatusUpdate(creds.organizationId, { id: msg.platformMessageId, status, timestamp: String(Math.floor(Date.parse(msg.sentAt) / 1000)) });
    return;
  }
  if (event.event !== "message.received" || msg.direction !== "incoming" || !msg.sender) return;
  if (await whatsappProvider(creds.organizationId) !== "zernio") return;
  const attachment = msg.attachments?.[0];
  const kind = attachment?.type === "file" ? "document" : attachment?.type;
  const binaryKind = kind && ["image", "audio", "video", "document", "sticker"].includes(kind) ? kind as "image" | "audio" | "video" | "document" | "sticker" : null;
  const mediaId = attachment?.payload?.id ?? (attachment?.url ? new URL(attachment.url).pathname.match(/\/whatsapp\/media\/([^/]+)$/)?.[1] : undefined);
  await ingestInboundMessage({
    organizationId: creds.organizationId, identity: whatsappZernioIdentity(msg.sender), waMessageId: msg.platformMessageId,
    type: binaryKind ?? "text", text: msg.text ?? (attachment ? "[Adjunto recibido]" : null),
    timestamp: String(Math.floor(Date.parse(msg.sentAt) / 1000)), threadRef: msg.conversationId,
    suppressAi: event.metadata?.standby === true,
    media: binaryKind && mediaId ? { kind: binaryKind, waMediaId: `zernio:${creds.accountId}:${mediaId}`, mimeType: attachment?.payload?.mime_type ?? null, fileName: attachment?.payload?.filename ?? null, caption: msg.text ?? null, payload: null, fetchStatus: "pending" } : null,
  });
}
