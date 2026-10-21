"use client";

import { useCallback, useEffect, useState } from "react";
import { useEvents } from "@/components/use-events";

/**
 * Total de mensajes sin leer en la Bandeja. Lo usan el badge del menú y la
 * campana de la cabecera: cada instancia consulta una vez y se suscribe a los
 * eventos SSE para mantenerse al día.
 *
 * Devuelve `null` cuando el total no se pudo leer. Un `0` es una afirmación
 * («nadie está esperando»), y con un 500 de /api/conversations se leía justo
 * eso: la Bandeja llena y el contador apagado. `null` se pinta como si no
 * hubiera badge, que es lo que significa no saberlo.
 */
export function useUnreadCount(): number | null {
  const [unread, setUnread] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/conversations").catch(() => null);
    const data = res?.ok
      ? ((await res.json().catch(() => null)) as { conversations?: { unreadCount: number }[] } | null)
      : null;
    const list = data?.conversations;
    if (!Array.isArray(list)) {
      setUnread(null);
      return;
    }
    setUnread(list.reduce((a, c) => a + (c.unreadCount || 0), 0));
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
