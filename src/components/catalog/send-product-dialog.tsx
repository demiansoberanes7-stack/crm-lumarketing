"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import type { ConversationDto } from "@/lib/types";

/** Mismos canales que acepta el envío de cotizaciones (texto en todos). */
const SEND_CHANNELS = ["whatsapp", "instagram", "messenger"] as const;

/**
 * Selector de chat para enviar la ficha de un producto, igual que el de las
 * cotizaciones: el canal lo dicta el chat elegido, no un botón por canal.
 */
export function SendProductDialog({
  productId,
  productName,
  onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [chatId, setChatId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d: { conversations?: ConversationDto[] }) =>
        setConversations(Array.isArray(d.conversations) ? d.conversations : [])
      )
      .catch(() => setConversations([]));
  }, []);

  const chatsByChannel = useMemo(() => {
    const map = new Map<string, ConversationDto[]>();
    for (const channel of SEND_CHANNELS) {
      const list = conversations.filter((c) => c.channel === channel);
      if (list.length) map.set(channel, list);
    }
    return map;
  }, [conversations]);

  const selectedChat = useMemo(
    () => conversations.find((c) => c.id === chatId) ?? null,
    [conversations, chatId]
  );

  const send = useCallback(async () => {
    if (!selectedChat) return;
    setSending(true);
    setError("");
    const res = await fetch(`/api/catalog/${productId}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: selectedChat.id }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(data?.error?.message ?? "No se pudo enviar");
      return;
    }
    setSent(true);
  }, [productId, selectedChat]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Enviar producto</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {sent
            ? `Se envió "${productName}" al chat.`
            : `Elige el chat donde quieres enviar "${productName}".`}
        </p>

        {sent ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        ) : (
          <>
            {chatsByChannel.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay chats en canales conectados para enviar este producto.
              </p>
            ) : (
              <div className="space-y-2">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                >
                  <option value="">— Elige un chat —</option>
                  {[...chatsByChannel.entries()].map(([channel, list]) => (
                    <optgroup key={channel} label={CHANNEL_LABEL[channel as Channel]}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.contact.name}
                          {c.contact.phone ? ` · ${c.contact.phone}` : ""}
                          {c.humanAgentMode
                            ? " · respuesta con agente humano (hasta 7 días)"
                            : c.windowOpen
                              ? " · ventana abierta"
                              : " · ventana cerrada"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedChat && !selectedChat.windowOpen && selectedChat.channel !== "whatsapp" && (
                  <p className="text-xs text-amber-600">
                    {selectedChat.channel === "tiktok"
                      ? "Pasaron 48 horas desde el último mensaje. TikTok requiere que el cliente vuelva a escribir."
                      : "Pasaron 7 días desde el último mensaje; puede que ya no se pueda responder. Pide al cliente que vuelva a escribir."}
                  </p>
                )}
              </div>
            )}
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                disabled={!selectedChat || sending}
                onClick={() => void send()}
              >
                {sending
                  ? "Enviando…"
                  : selectedChat
                    ? `Enviar por ${CHANNEL_LABEL[selectedChat.channel as Channel]}`
                    : "Enviar"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
