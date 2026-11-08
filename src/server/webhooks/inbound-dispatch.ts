import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookPayload } from "@/server/inbox/webhook";
import { processWahaWebhookEvent } from "@/server/waha/webhook";
import { getInstagramCredentialsByIgUserId } from "@/server/instagram/credentials";
import { processMetaInstagramPayload } from "@/server/instagram/ingest";
import { getMessengerCredentialsByPageId } from "@/server/messenger/credentials";
import { processMetaPagePayload } from "@/server/messenger/ingest";
import { processZernioPayload, resolveZernioSecret } from "@/server/zernio/dispatch";
import { getWhatsappZernioByAccount } from "@/server/whatsapp/zernio-credentials";
import { ingestWhatsappZernio, whatsappZernioEvent } from "@/server/whatsapp/zernio-ingest";
import type { InboundEventRecord } from "@/server/webhooks/inbound-queue";

/** Dispatch a committed tenant-scoped receipt through the existing adapters. */
export async function processInboundWebhookEvent(event: InboundEventRecord): Promise<void> {
  if (!event.rawBody) throw new Error("El evento pendiente no tiene cuerpo");
  const payload: unknown = JSON.parse(event.rawBody);

  switch (event.provider) {
    case "meta_whatsapp": {
      const body = payload as WebhookPayload;
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (!value || !change.field) continue;
          const phoneNumberId = value.metadata?.phone_number_id;
          if (!phoneNumberId) continue;
          const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
          if (!credentials || credentials.organizationId !== event.organizationId) continue;
          if (change.field === "messages") {
            await processMessagesValue(value, { retryOnItemError: true });
          } else if (change.field === "smb_message_echoes") {
            await processEchoesValue(value, { retryOnItemError: true });
          }
        }
      }
      return;
    }
    case "waha":
      await processWahaWebhookEvent(event.organizationId, payload);
      return;
    case "meta_instagram": {
      const body = payload as { entry?: Array<{ id?: string }> };
      const igUserId = body.entry?.[0]?.id;
      const credentials = igUserId ? await getInstagramCredentialsByIgUserId(igUserId) : null;
      if (!credentials || credentials.organizationId !== event.organizationId || credentials.source !== "meta") return;
      await processMetaInstagramPayload(payload);
      return;
    }
    case "meta_messenger": {
      const body = payload as { entry?: Array<{ id?: string }> };
      const pageId = body.entry?.[0]?.id;
      const credentials = pageId ? await getMessengerCredentialsByPageId(pageId) : null;
      if (!credentials || credentials.organizationId !== event.organizationId || credentials.source !== "meta") return;
      await processMetaPagePayload(payload, { retryOnItemError: true });
      return;
    }
    case "zernio_instagram":
    case "zernio_messenger":
    case "zernio_tiktok": {
      const resolved = await resolveZernioSecret(event.rawBody);
      const expectedChannel = event.provider.slice("zernio_".length);
      if (
        !resolved.organizationId ||
        resolved.organizationId !== event.organizationId ||
        resolved.channel !== expectedChannel
      ) return;
      await processZernioPayload(payload, { retryOnItemError: true });
      return;
    }
    case "zernio_whatsapp": {
      const parsed = whatsappZernioEvent.safeParse(payload);
      if (!parsed.success) throw new Error("El evento pendiente de Zernio WhatsApp no coincide con el esquema");
      const accountId = parsed.data.account.accountId ?? parsed.data.account.id;
      if (!accountId) return;
      const credentials = await getWhatsappZernioByAccount(accountId);
      if (!credentials || credentials.organizationId !== event.organizationId) return;
      await ingestWhatsappZernio(parsed.data, credentials);
      return;
    }
  }
}
