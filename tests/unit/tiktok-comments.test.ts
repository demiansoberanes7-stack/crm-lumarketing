import { beforeEach, describe, expect, it, vi } from "vitest";

const { zernioFetch } = vi.hoisted(() => ({ zernioFetch: vi.fn() }));
vi.mock("@/server/zernio", () => ({ zernioFetch }));

import { fetchTikTokComments } from "@/server/comments/fetch";

const credentials = {
  id: "cred_1",
  organizationId: "org_1",
  source: "zernio" as const,
  tiktokUserId: null,
  username: "brand",
  accountRef: "account_1",
  webhookSecret: null,
  status: "connected" as const,
  token: "secret",
};

describe("comentarios de TikTok vía Zernio", () => {
  beforeEach(() => zernioFetch.mockReset());

  it("lista posts y comentarios, incluyendo replies con su autor y padre", async () => {
    zernioFetch
      .mockResolvedValueOnce({
        data: [{ id: "video_1", platform: "tiktok", content: "Mi video", commentCount: 1 }],
      })
      .mockResolvedValueOnce({
        comments: [{
          id: "comment_1",
          message: "¿Cuánto cuesta?",
          createdTime: "2026-10-12T18:00:00.000Z",
          from: { id: "author_1", username: "cliente" },
          replies: [{
            id: "reply_1",
            message: "¿Tienen envío?",
            createdTime: "2026-10-12T18:01:00.000Z",
            from: { id: "author_2", username: "otra_persona" },
          }],
        }],
        pagination: { hasMore: false, cursor: null },
      });

    const result = await fetchTikTokComments(credentials);

    expect(result).toMatchObject({ comments: [
      {
        externalCommentId: "comment_1",
        postExternalId: "video_1",
        postCaption: "Mi video",
        authorExternalId: "author_1",
        authorName: "cliente",
        body: "¿Cuánto cuesta?",
        parentExternalId: null,
      },
      {
        externalCommentId: "reply_1",
        postExternalId: "video_1",
        authorExternalId: "author_2",
        body: "¿Tienen envío?",
        parentExternalId: "comment_1",
      },
    ] });
    expect(zernioFetch).toHaveBeenNthCalledWith(
      1,
      "/inbox/comments?platform=tiktok&accountId=account_1&limit=25",
      { token: "secret" }
    );
    expect(zernioFetch.mock.calls[1]?.[0]).toContain("/inbox/comments/video_1?");
    expect(zernioFetch.mock.calls[1]?.[0]).toContain("accountId=account_1");
  });

  it("degrada con un error claro si no hay cuenta Zernio enrutable", async () => {
    const result = await fetchTikTokComments({ ...credentials, accountRef: null });
    expect(result).toEqual({ error: "TikTok necesita una cuenta de Zernio para leer comentarios" });
    expect(zernioFetch).not.toHaveBeenCalled();
  });
});
