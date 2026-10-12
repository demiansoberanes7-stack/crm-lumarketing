import { mockGuard } from "@/lib/dev-guard";
import {
  nextZernioMessageId,
  resetZernioMock,
  zernioMockState,
  zernioTokenIsBad,
} from "@/server/dev/zernio-mock-state";

export const dynamic = "force-dynamic";

/**
 * 017 — Zernio de mentira para el self-test. Tras `mockGuard()`: 404
 * incondicional en producción, indistinguible de una ruta inexistente.
 *
 * Imita lo único que Vocero usa de esa API —listar conversaciones (que es como
 * se valida la llave) y responder en una— y expone `_sent` y `_reset` para que
 * el arnés pueda afirmar sobre lo que recibió.
 */

type Ctx = { params: Promise<{ path: string[] }> };

function unauthorized(): Response {
  return Response.json(
    { error: { message: "Invalid API key" } },
    { status: 401 }
  );
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "_sent") {
    return Response.json({
      sent: zernioMockState().sent,
      commentReplies: zernioMockState().commentReplies,
    });
  }
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  // GET /inbox/conversations → lo que usa la validación de la llave.
  if (route === "inbox/conversations") {
    return Response.json({ data: [], hasMore: false });
  }
  if (route === "whatsapp/number-info") {
    const accountId = new URL(req.url).searchParams.get("accountId");
    return Response.json({ phone: {
      display_phone_number: "+52 55 0000 0000",
      status: accountId?.endsWith("-disconnected") ? "DISCONNECTED" : "CONNECTED",
    } });
  }
  if (route === "inbox/comments") {
    const url = new URL(req.url);
    if (url.searchParams.get("platform") === "tiktok") {
      return Response.json({
        data: [{
          id: "tt-video-mock-001",
          platformPostId: "tt-video-mock-001",
          platform: "tiktok",
          accountId: url.searchParams.get("accountId"),
          content: "Video de prueba TikTok",
          commentCount: 1,
        }],
        pagination: { hasMore: false, nextCursor: null },
      });
    }
  }
  if (route === "inbox/comments/tt-video-mock-001") {
    return Response.json({
      comments: [{
        id: "tt-comment-mock-001",
        message: "Comentario de prueba TikTok",
        createdTime: new Date().toISOString(),
        from: { id: "tt-author-mock-001", username: "cliente_tiktok" },
        replies: [],
      }],
      pagination: { hasMore: false, cursor: null },
    });
  }
  return Response.json({});
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;

  if (path.join("/") === "_reset") {
    resetZernioMock();
    return Response.json({ ok: true });
  }
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  // POST /media/upload-direct — direct API-key upload returns a public URL.
  if (path.join("/") === "media/upload-direct") {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Missing file" }, { status: 400 });
    return Response.json({
      url: `https://media.zernio.test/${encodeURIComponent(file.name)}`,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });
  }

  // POST /inbox/conversations/{id}/messages
  if (
    path.length === 4 &&
    path[0] === "inbox" &&
    path[1] === "conversations" &&
    path[3] === "messages"
  ) {
    let body: Record<string, unknown>;
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const attachment = form.get("attachment");
      body = {
        accountId: form.get("accountId"),
        message: form.get("message"),
        messagingType: form.get("messagingType"),
        messageTag: form.get("messageTag"),
        ...(attachment instanceof File
          ? {
              attachmentName: attachment.name,
              attachmentType: attachment.type,
              attachmentSize: attachment.size,
            }
          : {}),
      };
    } else {
      body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    }
    const state = zernioMockState();
    const id = nextZernioMessageId();
    state.sent.push({
      n: state.seq,
      conversationId: decodeURIComponent(path[2]!),
      accountId: body.accountId ? String(body.accountId) : null,
      message: String(body.message ?? ""),
      ...(body.messagingType ? { messagingType: String(body.messagingType) } : {}),
      ...(body.messageTag ? { messageTag: String(body.messageTag) } : {}),
      ...(body.attachmentName ? { attachmentName: String(body.attachmentName) } : {}),
      ...(body.attachmentType ? { attachmentType: String(body.attachmentType) } : {}),
      ...(body.attachmentUrl ? { attachmentUrl: String(body.attachmentUrl) } : {}),
      ...(typeof body.attachmentSize === "number" ? { attachmentSize: body.attachmentSize } : {}),
      idempotencyKey: req.headers.get("idempotency-key"),
      at: new Date().toISOString(),
    });
    return Response.json({ message: { id } });
  }

  // POST /inbox/comments/{postId} — reply público del negocio a un comentario.
  if (path.length === 3 && path[0] === "inbox" && path[1] === "comments") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = zernioMockState();
    const id = nextZernioMessageId();
    state.commentReplies.push({
      n: state.seq,
      postId: decodeURIComponent(path[2]!),
      commentId: body.commentId ? String(body.commentId) : null,
      accountId: body.accountId ? String(body.accountId) : null,
      message: String(body.message ?? ""),
      idempotencyKey: req.headers.get("idempotency-key"),
      at: new Date().toISOString(),
    });
    return Response.json({ success: true, data: { commentId: id, isReply: true } });
  }

  return Response.json({});
}
