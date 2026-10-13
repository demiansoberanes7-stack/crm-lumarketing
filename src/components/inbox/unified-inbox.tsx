"use client";
import { useSearchParams } from "next/navigation";
import type { Channel } from "@/lib/channels";
import { EmailChatClient } from "@/components/email/email-chat-client";
import { InboxClient } from "./inbox-client";

/**
 * El buzón NO es una pantalla aparte con su propia barra de navegación: es
 * una bandeja más. La conmutación entre Bandeja y canales vive dentro del
 * header del propio buzón (mismo patrón que ConversationList), así que aquí
 * solo se decide qué cliente se monta.
 */
export function UnifiedInbox({ channels }: { channels: readonly Channel[] }) {
  const email = useSearchParams().get("channel") === "email";
  if (!email) return <InboxClient channels={channels} />;
  return <EmailChatClient channels={channels} />;
}
