import { describe, expect, it } from "vitest";
import { groupEmailThreads, type ThreadableEmail } from "@/components/email/threading";

const message = (input: Partial<ThreadableEmail> & Pick<ThreadableEmail, "id" | "messageId" | "direction" | "createdAt">): ThreadableEmail => ({
  id: input.id,
  messageId: input.messageId,
  threadId: input.threadId ?? null,
  direction: input.direction,
  createdAt: input.createdAt,
  seen: input.seen ?? true,
});

describe("groupEmailThreads", () => {
  it("agrupa replies encadenadas y calcula unread de toda la conversación", () => {
    const root = message({ id: "1", messageId: "<root>", direction: "inbound", createdAt: "2026-10-09T10:00:00Z", seen: true });
    const reply = message({ id: "2", messageId: "<reply>", threadId: "<root>", direction: "outbound", createdAt: "2026-10-09T10:02:00Z" });
    const followup = message({ id: "3", messageId: "<followup>", threadId: "<reply>", direction: "inbound", createdAt: "2026-10-09T10:04:00Z", seen: false });

    const [thread] = groupEmailThreads([reply, followup, root]);
    expect(thread?.id).toBe("<root>");
    expect(thread?.messages.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(thread?.latest.id).toBe("3");
    expect(thread?.unread).toBe(true);
  });

  it("mantiene juntos mensajes cuyo mensaje padre ya salió de la página", () => {
    const older = message({ id: "1", messageId: "<older>", threadId: "<root-not-loaded>", direction: "inbound", createdAt: "2026-10-09T10:00:00Z" });
    const newer = message({ id: "2", messageId: "<newer>", threadId: "<root-not-loaded>", direction: "outbound", createdAt: "2026-10-09T10:02:00Z" });
    expect(groupEmailThreads([older, newer])).toHaveLength(1);
  });
});
