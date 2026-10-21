import { describe, expect, it } from "vitest";
import {
  isWindowOpen,
  isWindowOpenFor,
  replyWindowState,
  WINDOW_MS,
  windowRemainingMs,
} from "@/server/inbox/window";

describe("ventana de 24 horas (FR-005)", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("entrante hace 1 hora → abierta", () => {
    const last = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isWindowOpen(last, now)).toBe(true);
  });

  it("entrante hace 25 horas → cerrada", () => {
    const last = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isWindowOpen(last, now)).toBe(false);
  });

  it("borde exacto de 24h → cerrada (estricto)", () => {
    const last = new Date(now.getTime() - WINDOW_MS);
    expect(isWindowOpen(last, now)).toBe(false);
  });

  it("un milisegundo antes del borde → abierta", () => {
    const last = new Date(now.getTime() - WINDOW_MS + 1);
    expect(isWindowOpen(last, now)).toBe(true);
  });

  it("conversación sin ningún entrante → cerrada", () => {
    expect(isWindowOpen(null, now)).toBe(false);
    expect(windowRemainingMs(null, now)).toBe(0);
  });

  it("remaining decrece y nunca es negativo", () => {
    const last = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    const remaining = windowRemainingMs(last, now);
    expect(remaining).toBe(60 * 60 * 1000);
    const old = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    expect(windowRemainingMs(old, now)).toBe(0);
  });

  it("una ventana específica de TikTok dura 48 horas", () => {
    const last = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    expect(isWindowOpenFor(last, 48 * 60 * 60 * 1000, now)).toBe(true);
    expect(
      isWindowOpenFor(
        new Date(now.getTime() - 48 * 60 * 60 * 1000),
        48 * 60 * 60 * 1000,
        now
      )
    ).toBe(false);
  });
});

describe("política de HUMAN_AGENT: manual sí, automático no", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const meta = { windowMs: WINDOW_MS, outsideWindow: "human_agent_tag" as const };
  const tiktok = { windowMs: 48 * 60 * 60 * 1000, outsideWindow: "none" as const };
  const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  it("dentro de la ventana estándar no hace falta etiqueta", () => {
    expect(
      replyWindowState(ago(1), meta, { allowHumanAgentTag: false }, now)
    ).toBe("open");
  });

  it("una respuesta manual entre 24 h y 7 días usa HUMAN_AGENT", () => {
    expect(
      replyWindowState(ago(25), meta, { allowHumanAgentTag: true }, now)
    ).toBe("human_agent");
  });

  it("un envío automático entre 24 h y 7 días queda bloqueado", () => {
    expect(
      replyWindowState(ago(25), meta, { allowHumanAgentTag: false }, now)
    ).toBe("closed");
  });

  it("ni siquiera una respuesta manual pasa de 7 días", () => {
    expect(
      replyWindowState(ago(7 * 24 + 1), meta, { allowHumanAgentTag: true }, now)
    ).toBe("closed");
  });

  it("TikTok no tiene etiqueta: fuera de 48 h queda bloqueado", () => {
    expect(
      replyWindowState(ago(49), tiktok, { allowHumanAgentTag: true }, now)
    ).toBe("closed");
  });

  it("sin mensaje entrante la ventana está cerrada", () => {
    expect(
      replyWindowState(null, meta, { allowHumanAgentTag: true }, now)
    ).toBe("closed");
  });

  it("un canal sin ventana siempre está abierto", () => {
    expect(
      replyWindowState(null, { windowMs: null, outsideWindow: "none" }, {
        allowHumanAgentTag: false,
      })
    ).toBe("open");
  });
});
