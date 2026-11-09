"use client";

import { useCallback, useEffect, useState } from "react";
import { useEvents } from "@/components/use-events";

/**
 * Total de mensajes sin leer en la Bandeja. Lo usan el badge del menú y la
 * campana de la cabecera: cada instancia consulta una vez y se suscribe a los
 * eventos SSE para mantenerse al día.
 *
 * Pide solo la cifra (`/api/conversations/unread`): antes traía la lista
 * entera de conversaciones solo para sumar `unreadCount` en el cliente.
 *
 * Devuelve `null` cuando el total no se pudo leer. Un `0` es una afirmación
 * («nadie está esperando»), y con un 500 se leía justo eso: la Bandeja llena
 * y el contador apagado. `null` se pinta como si no hubiera badge, que es lo
 * que significa no saberlo.
 */
export function useUnreadCount(): number | null {
  const [unread, setUnread] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/conversations/unread").catch(() => null);
    const data = res?.ok
      ? ((await res.json().catch(() => null)) as { unread?: number } | null)
      : null;
    if (typeof data?.unread !== "number") {
      setUnread(null);
      return;
    }
    setUnread(data.unread);
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
