"use client";

import { useCallback, useEffect, useState } from "react";
import { useEvents } from "@/components/use-events";

/**
 * Total de mensajes sin leer en la Bandeja. Lo usan el badge del menú y la
 * campana de la cabecera: cada instancia consulta una vez y se suscribe a los
 * eventos SSE para mantenerse al día.
 */
export function useUnreadCount(): number {
  const [unread, setUnread] = useState(0);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      conversations: { unreadCount: number }[];
    };
    setUnread(data.conversations.reduce((a, c) => a + c.unreadCount, 0));
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onMessageNew: () => void refetch(),
    onConversationUpdated: () => void refetch(),
  });

  return unread;
}
