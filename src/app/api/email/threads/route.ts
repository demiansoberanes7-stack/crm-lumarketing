import { apiError, intParam, withAuth } from "@/lib/api";
import { listMessages } from "@/server/email/service";
import { groupEmailThreads, type EmailThread } from "@/components/email/threading";

export const dynamic = "force-dynamic";

type EmailRow = {
  id: string;
  messageId: string;
  threadId: string | null;
  direction: "inbound" | "outbound";
  from: string;
  to: { value: Array<{ address: string; name: string }> } | null;
  subject: string;
  bodyText: string | null;
  createdAt: Date | string;
  seen: boolean;
};

export type EmailChatThread = {
  id: string;
  subject: string;
  participant: { name: string; email: string };
  messages: {
    id: string;
    /** Message-ID RFC: es el que va en el header In-Reply-To de una respuesta. */
    messageId: string;
    direction: "inbound" | "outbound";
    from: string;
    text: string | null;
    createdAt: string;
    /** ¿Ya se abrió? El buzón lo pinta como leído al abrir el hilo. */
    seen: boolean;
  }[];
  unread: boolean;
  /** Correos entrantes sin abrir: es el badge del renglón. */
  unreadCount: number;
  latestAt: string;
};

/** Nombre legible del corresponsal: el primer nombre del To, o el email. */
function participantName(email: string, to: EmailRow["to"]): { name: string; email: string } {
  const entry = to?.value?.find((v) => v.address === email);
  const name = entry?.name?.trim();
  return { name: name && name !== email ? name : email, email };
}

function toChatThread(thread: EmailThread<EmailRow>): EmailChatThread {
  const inbound = thread.messages.find((m) => m.direction === "inbound");
  const correspondent = inbound?.from ?? thread.latest.to?.value?.[0]?.address ?? thread.latest.from;
  return {
    id: thread.id,
    subject: thread.latest.subject || "(sin asunto)",
    participant: participantName(correspondent, thread.latest.to),
    messages: thread.messages.map((m) => ({
      id: m.id,
      messageId: m.messageId,
      direction: m.direction,
      from: m.from,
      text: m.bodyText,
      createdAt: new Date(m.createdAt).toISOString(),
      seen: m.seen,
    })),
    unread: thread.unread,
    unreadCount: thread.messages.filter(
      (m) => m.direction === "inbound" && !m.seen
    ).length,
    latestAt: new Date(thread.latest.createdAt).toISOString(),
  };
}

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  if (!accountId) return apiError(400, "missing_param", "accountId es requerido");
  const limit = intParam(url, "limit", { fallback: 200, min: 1, max: 500 });

  const messages = await listMessages(session.organizationId, accountId, { limit });
  const threads = groupEmailThreads(messages as unknown as EmailRow[]).map(toChatThread);
  return Response.json({ threads });
});
