import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  commentContactIdentity,
  commentGroupKey,
  foldCommentThreads,
  groupCommentsByPost,
  parseCommentIdentity,
} from "@/lib/comment-thread";
import { CommentsThread } from "@/components/inbox/comments-thread";
import type { MessageDto } from "@/lib/types";

function message(
  id: string,
  createdAt: string,
  comment: MessageDto["comment"] = null,
  direction: MessageDto["direction"] = comment ? "in" : "out"
): MessageDto {
  return {
    id,
    conversationId: "conv_1",
    direction,
    type: "text",
    text: id,
    status: "delivered",
    error: null,
    aiGenerated: false,
    origin: "operator",
    media: null,
    comment,
    createdAt,
  };
}

function inbound(
  id: string,
  createdAt: string,
  postExternalId: string,
  extras: Partial<NonNullable<MessageDto["comment"]>> = {}
): MessageDto {
  return message(
    id,
    createdAt,
    {
      platform: "messenger",
      externalCommentId: `ext_${id}`,
      postExternalId,
      postCaption: `Caption ${postExternalId}`,
      authorName: "Zale Ale",
      parentExternalId: null,
      postUrl: null,
      ...extras,
    },
    "in"
  );
}

describe("identidad de comentarios por persona", () => {
  it("la identidad nueva es prefijo + autor, sin publicación", () => {
    expect(commentContactIdentity("instagram", "author_1")).toBe("igc:author_1");
    expect(commentContactIdentity("messenger", "author_2")).toBe("fbc:author_2");
    expect(commentContactIdentity("tiktok", "author_3")).toBe("ttc:author_3");
  });

  it("lee la identidad nueva", () => {
    expect(parseCommentIdentity("fbc:author_2")).toEqual({
      platform: "messenger",
      authorExternalId: "author_2",
      legacyPostExternalId: null,
    });
  });

  it("sigue leyendo la identidad vieja con la publicación incrustada", () => {
    expect(parseCommentIdentity("igc:post_9:author_1")).toEqual({
      platform: "instagram",
      authorExternalId: "author_1",
      legacyPostExternalId: "post_9",
    });
  });

  it("un prefijo desconocido o vacío no es identidad de comentarios", () => {
    expect(parseCommentIdentity("wa:5215512345678")).toBeNull();
    expect(parseCommentIdentity("igc:")).toBeNull();
    expect(parseCommentIdentity(":autor")).toBeNull();
  });

  it("vieja y nueva caen en la MISMA llave de persona", () => {
    expect(commentGroupKey("fbc:post_1:author_7")).toBe("fbc:author_7");
    expect(commentGroupKey("fbc:author_7")).toBe("fbc:author_7");
    // Plataformas distintas son personas distintas aunque compartan el id.
    expect(commentGroupKey("igc:author_7")).not.toBe("fbc:author_7");
  });
});

describe("una fila de bandeja por persona", () => {
  const row = (
    id: string,
    identity: string,
    unread: number,
    channel = "comments"
  ) => ({
    id,
    conversation: { id, channel, unreadCount: unread },
    contact: { waIdentity: identity },
  });

  it("funde las conversaciones por publicación con la nueva por autor", () => {
    const rows = [
      row("c_new", "fbc:author_1", 1),
      row("c_post_b", "fbc:post_b:author_1", 2),
      row("c_post_a", "fbc:post_a:author_1", 3),
    ];

    const folded = foldCommentThreads(rows);

    expect(folded).toHaveLength(1);
    // Se abre la más reciente (la que entrega SQL primero) y hereda el total.
    expect(folded[0]?.id).toBe("c_new");
    expect(folded[0]?.conversation.unreadCount).toBe(6);
  });

  it("no toca las filas de otros canales ni personas distintas", () => {
    const rows = [
      row("wa_1", "5215512345678", 2, "whatsapp"),
      row("c_1", "fbc:author_1", 1),
      row("c_2", "fbc:author_2", 1),
    ];

    expect(foldCommentThreads(rows).map((r) => r.id)).toEqual([
      "wa_1",
      "c_1",
      "c_2",
    ]);
  });

  it("no muta las filas originales", () => {
    const rows = [
      row("c_new", "fbc:author_1", 1),
      row("c_old", "fbc:post_a:author_1", 2),
    ];

    foldCommentThreads(rows);

    expect(rows[0]?.conversation.unreadCount).toBe(1);
    expect(rows[1]?.conversation.unreadCount).toBe(2);
  });
});

describe("hilo de una persona con varias publicaciones", () => {
  it("cada publicación lleva su tarjeta y sus comentarios", () => {
    const groups = groupCommentsByPost([
      inbound("m1", "2026-10-12T10:00:00.000Z", "post_a"),
      message("m2", "2026-10-12T10:05:00.000Z"),
      inbound("m3", "2026-10-13T09:00:00.000Z", "post_b", {
        platform: "instagram",
        postCaption: "Otra publicación",
      }),
      message("m4", "2026-10-13T09:05:00.000Z"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: "messenger:post_a",
      postCaption: "Caption post_a",
      inboundCount: 1,
    });
    // El saliente cuelga de la publicación del último comentario visto.
    expect(groups[0]?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(groups[1]).toMatchObject({
      key: "instagram:post_b",
      platform: "instagram",
      postCaption: "Otra publicación",
      inboundCount: 1,
    });
    expect(groups[1]?.messages.map((m) => m.id)).toEqual(["m3", "m4"]);
  });

  it("si la persona vuelve a una publicación, sus mensajes se reúnen ahí", () => {
    const groups = groupCommentsByPost([
      inbound("a1", "2026-10-12T10:00:00.000Z", "post_a"),
      inbound("b1", "2026-10-12T11:00:00.000Z", "post_b"),
      inbound("a2", "2026-10-12T12:00:00.000Z", "post_a"),
    ]);

    expect(groups).toHaveLength(2);
    const postA = groups.find((g) => g.postExternalId === "post_a");
    expect(postA?.messages.map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(postA?.inboundCount).toBe(2);
  });

  it("toma el caption de cualquier comentario del grupo que sí lo traiga", () => {
    const groups = groupCommentsByPost([
      inbound("m1", "2026-10-12T10:00:00.000Z", "post_a", { postCaption: null }),
      inbound("m2", "2026-10-12T10:01:00.000Z", "post_a", {
        postCaption: "Caption recuperado",
      }),
    ]);

    expect(groups[0]?.postCaption).toBe("Caption recuperado");
  });

  it("un saliente anterior a todo comentario no se pierde", () => {
    const groups = groupCommentsByPost([
      message("out_0", "2026-10-12T09:00:00.000Z"),
      inbound("m1", "2026-10-12T10:00:00.000Z", "post_a"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages.map((m) => m.id)).toEqual(["out_0", "m1"]);
  });

  it("sin comentarios no inventa tarjetas", () => {
    expect(
      groupCommentsByPost([message("out_1", "2026-10-12T09:00:00.000Z")])
    ).toEqual([]);
  });

  it("el HTML pinta una tarjeta de publicación por post, sin repetir la de otro", () => {
    const html = renderToStaticMarkup(
      createElement(CommentsThread, {
        contactName: "Zale Ale",
        messages: [
          inbound("m1", "2026-10-12T10:00:00.000Z", "post_a"),
          message("m2", "2026-10-12T10:05:00.000Z"),
          inbound("m3", "2026-10-13T09:00:00.000Z", "post_b", {
            postCaption: "Otra publicación",
          }),
        ],
      })
    );

    expect(html.match(/Publicación de Facebook/g)).toHaveLength(2);
    expect(html).toContain("Caption post_a");
    expect(html).toContain("Otra publicación");
    // Cada persona/hilo conserva su nombre en las burbujas.
    expect(html).toContain("Zale Ale");
  });
});
