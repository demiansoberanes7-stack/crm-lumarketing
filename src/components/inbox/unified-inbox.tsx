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
 *
 * `channels` es el catálogo completo y `enabledChannels` lo que esta
 * instancia puede recibir hoy. El buzón de correo solo enlaza a los canales
 * encendidos: un enlace a una bandeja apagada sería un callejón sin salida.
 */
export function UnifiedInbox({
  channels,
  enabledChannels,
}: {
  channels: readonly Channel[];
  enabledChannels: readonly Channel[];
}) {
  const email = useSearchParams().get("channel") === "email";
  if (!email) {
    return <InboxClient channels={channels} enabledChannels={enabledChannels} />;
  }
  return <EmailChatClient channels={enabledChannels} />;
}
