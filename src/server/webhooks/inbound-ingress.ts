import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { getInstagramCredentialsByIgUserId } from "@/server/instagram/credentials";
import { getMessengerCredentialsByPageId } from "@/server/messenger/credentials";
import { resolveZernioSecret } from "@/server/zernio/dispatch";
import type { WhatsappZernioCredentials } from "@/server/whatsapp/zernio-credentials";
import { getWahaOrganizationByWebhookToken } from "@/server/waha/webhook";
import {
  enqueueInboundWebhook,
  inboundWebhookEventKey,
  inboundWebhookPayloadKey,
  type InboundWebhookProvider,
} from "@/server/webhooks/inbound-queue";
import type { WebhookPayload, WebhookValue } from "@/server/inbox/webhook";
import type { ZernioEvent } from "@/server/zernio";

export type PersistedWebhookBatch = { queued: number; ignored: number };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function persist(
  organizationId: string,
  provider: InboundWebhookProvider,
  eventType: string,
  identity: string | null,
  rawBody: string
): Promise<void> {
  const idempotencyKey = identity
    ? inboundWebhookEventKey(provider, organizationId, `${eventType}\0${identity}`)
    : inboundWebhookPayloadKey(provider, organizationId, stableJson(JSON.parse(rawBody)));
  await enqueueInboundWebhook({ organizationId, provider, idempotencyKey, eventType, rawBody });
}

function metaEnvelope(object: string | undefined, entry: unknown): string {
  return JSON.stringify({ ...(object ? { object } : {}), entry: [entry] });
}

function matchingWaContacts(value: WebhookValue, message: { from?: string; from_user_id?: string }) {
  if (!message.from && !message.from_user_id) return [];
  return (value.contacts ?? []).filter(
    (contact) =>
      (message.from && contact.wa_id === message.from) ||
      (message.from_user_id && contact.user_id === message.from_user_id)
  );
}

/** Persist one tenant-scoped WhatsApp Meta item per message, status or echo. */
export async function persistMetaWhatsAppPayload(rawBody: string): Promise<PersistedWebhookBatch> {
  const payload = JSON.parse(rawBody) as WebhookPayload;
  let queued = 0;
  let ignored = 0;
  const entries = Array.isArray(payload.entry) ? payload.entry : payload.entry ? [payload.entry] : [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (!change.value || (change.field !== "messages" && change.field !== "smb_message_echoes")) {
        ignored++;
        continue;
      }
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      const creds = phoneNumberId ? await getCredentialsByPhoneNumberId(phoneNumberId) : null;
      if (!creds) {
        // No tenant can be proven. Preserve the current unknown-number discard;
        // never write a raw payload to an unscoped or guessed organization.
        ignored++;
        continue;
      }

      const sourceEvents: { kind: string; item: Record<string, unknown>; identity: string | null; contacts?: unknown[] }[] = [];
      if (change.field === "smb_message_echoes") {
        for (const echo of value.message_echoes ?? value.messages ?? []) {
          sourceEvents.push({
            kind: "echo",
            item: echo as unknown as Record<string, unknown>,
            identity: echo.id ? `echo:${echo.id}` : null,
          });
        }
      } else {
        for (const message of value.messages ?? []) {
          sourceEvents.push({
            kind: "message",
            item: message as unknown as Record<string, unknown>,
            identity: message.id ? `message:${message.id}` : null,
            contacts: matchingWaContacts(value, message),
          });
        }
        for (const status of value.statuses ?? []) {
          sourceEvents.push({
            kind: "status",
            item: status as unknown as Record<string, unknown>,
            identity: status.id
              ? `status:${status.id}:${status.status}:${status.timestamp}`
              : null,
          });
        }
      }

      if (sourceEvents.length === 0) {
        ignored++;
        continue;
      }
      for (const sourceEvent of sourceEvents) {
        const valuePart: Record<string, unknown> = {
          ...value,
          ...(sourceEvent.kind === "message"
            ? { messages: [sourceEvent.item], statuses: [] }
            : sourceEvent.kind === "status"
              ? { messages: [], statuses: [sourceEvent.item] }
              : { messages: [], statuses: [], message_echoes: [sourceEvent.item] }),
          ...(sourceEvent.contacts ? { contacts: sourceEvent.contacts } : {}),
        };
        const subEntry = {
          ...(entry.id ? { id: entry.id } : {}),
          changes: [{ field: change.field, value: valuePart }],
        };
        const body = metaEnvelope(payload.object, subEntry);
        const eventType = `${change.field}.${sourceEvent.kind}`;
        await persist(
          creds.organizationId,
          "meta_whatsapp",
          eventType,
          sourceEvent.identity,
          body
        );
        queued++;
      }
    }
  }
  return { queued, ignored };
}

/** WAHA URL token is checked before persisting; unknown tokens remain ACK/drop as before. */
export async function persistWahaPayload(
  token: string,
  rawBody: string
): Promise<PersistedWebhookBatch> {
  const organizationId = await getWahaOrganizationByWebhookToken(token);
  if (!organizationId) return { queued: 0, ignored: 1 };
  const payload = JSON.parse(rawBody) as { event?: string; session?: string; payload?: Record<string, unknown> };
  if (!payload?.event || !payload.payload) return { queued: 0, ignored: 1 };
  const id = String(
    payload.payload.id ??
      (payload.payload.key as Record<string, unknown> | undefined)?.id ??
      ""
  );
  const ack = payload.payload.ack;
  const identity = id
    ? `${payload.event}:${id}${typeof ack === "number" ? `:${ack}` : ""}`
    : null;
  await persist(organizationId, "waha", payload.event, identity, rawBody);
  return { queued: 1, ignored: 0 };
}

/** Meta Instagram: split by page entry and message id before tenant storage. */
export async function persistMetaInstagramPayload(rawBody: string): Promise<PersistedWebhookBatch> {
  const payload = JSON.parse(rawBody) as {
    object?: string;
    entry?: Array<{ id?: string; messaging?: Array<{ message?: { mid?: string; is_echo?: boolean } }> }>;
  };
  let queued = 0;
  let ignored = 0;
  if (payload.object !== "instagram") return { queued: 0, ignored: 1 };
  for (const entry of payload.entry ?? []) {
    const creds = entry.id ? await getInstagramCredentialsByIgUserId(entry.id) : null;
    if (!creds || creds.source !== "meta") {
      ignored++;
      continue;
    }
    for (const messaging of entry.messaging ?? []) {
      const mid = messaging.message?.mid;
      if (!mid || messaging.message?.is_echo) {
        ignored++;
        continue;
      }
      const body = metaEnvelope(payload.object, { ...entry, messaging: [messaging] });
      await persist(creds.organizationId, "meta_instagram", "message", `message:${mid}`, body);
      queued++;
    }
  }
  return { queued, ignored };
}

/** Meta Messenger: each page/message is stored only under that page's tenant. */
export async function persistMetaMessengerPayload(rawBody: string): Promise<PersistedWebhookBatch> {
  const payload = JSON.parse(rawBody) as {
    object?: string;
    entry?: Array<{ id?: string; messaging?: Array<{ message?: { mid?: string; is_echo?: boolean } }> }>;
  };
  let queued = 0;
  let ignored = 0;
  if (payload.object !== "page") return { queued: 0, ignored: 1 };
  for (const entry of payload.entry ?? []) {
    const creds = entry.id ? await getMessengerCredentialsByPageId(entry.id) : null;
    if (!creds || creds.source !== "meta") {
      ignored++;
      continue;
    }
    for (const messaging of entry.messaging ?? []) {
      const mid = messaging.message?.mid;
      if (!mid) {
        ignored++;
        continue;
      }
      const body = metaEnvelope(payload.object, { ...entry, messaging: [messaging] });
      await persist(creds.organizationId, "meta_messenger", "message", `message:${mid}`, body);
      queued++;
    }
  }
  return { queued, ignored };
}

/** Zernio's shared webhook can carry Instagram, Facebook/Messenger or TikTok. */
export async function persistZernioPayload(
  rawBody: string,
  resolved?: Awaited<ReturnType<typeof resolveZernioSecret>>
): Promise<PersistedWebhookBatch> {
  const owner = resolved ?? (await resolveZernioSecret(rawBody));
  if (!owner.organizationId || !owner.accountRef || !owner.channel) {
    return { queued: 0, ignored: 1 };
  }
  const event = JSON.parse(rawBody) as ZernioEvent;
  const source = `zernio_${owner.channel}` as InboundWebhookProvider;
  const message = event.message as (ZernioEvent["message"] & { platformMessageId?: string }) | undefined;
  const providerId = message?.platformMessageId ?? message?.id ?? event.id;
  const identity = providerId
    ? `${owner.accountRef}:${event.event ?? "event"}:${providerId}:${message?.direction ?? ""}`
    : null;
  await persist(owner.organizationId, source, event.event ?? "event", identity, rawBody);
  return { queued: 1, ignored: 0 };
}

/** Zernio WhatsApp has a separate signature/account credential table. */
export async function persistZernioWhatsAppPayload(
  rawBody: string,
  credentials: WhatsappZernioCredentials,
  event: { event: string; account: { id?: string; accountId?: string } ; message: { platformMessageId?: string; id?: string; direction?: string } }
): Promise<PersistedWebhookBatch> {
  const accountId = event.account.accountId ?? event.account.id;
  if (!accountId || accountId !== credentials.accountId) return { queued: 0, ignored: 1 };
  const messageId = event.message.platformMessageId ?? event.message.id;
  const identity = messageId
    ? `${accountId}:${event.event}:${messageId}:${event.message.direction ?? ""}`
    : null;
  await persist(credentials.organizationId, "zernio_whatsapp", event.event, identity, rawBody);
  return { queued: 1, ignored: 0 };
}
