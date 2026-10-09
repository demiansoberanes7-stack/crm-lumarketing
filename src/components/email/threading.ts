export type ThreadableEmail = {
  id: string;
  messageId: string;
  threadId: string | null;
  direction: "inbound" | "outbound";
  createdAt: Date | string;
  seen: boolean;
};

export type EmailThread<T extends ThreadableEmail> = {
  id: string;
  messages: T[];
  latest: T;
  unread: boolean;
};

/** Resolves direct In-Reply-To chains into one visible mail conversation. */
export function groupEmailThreads<T extends ThreadableEmail>(messages: T[]): EmailThread<T>[] {
  const byMessageId = new Map(messages.map((message) => [message.messageId, message]));
  const rootFor = (message: T) => {
    let current = message;
    const visited = new Set([current.messageId]);
    while (current.threadId) {
      const parent = byMessageId.get(current.threadId);
      if (!parent) return current.threadId;
      if (visited.has(parent.messageId)) break;
      visited.add(parent.messageId);
      current = parent;
    }
    return current.messageId || current.id;
  };

  const grouped = new Map<string, T[]>();
  for (const message of messages) {
    const id = rootFor(message);
    const thread = grouped.get(id) ?? [];
    thread.push(message);
    grouped.set(id, thread);
  }

  return [...grouped].map(([id, threadMessages]) => {
    const ordered = [...threadMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return {
      id,
      messages: ordered,
      latest: ordered[ordered.length - 1]!,
      unread: ordered.some((message) => !message.seen && message.direction === "inbound"),
    };
  }).sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
}
