import { describe, it, expect } from "vitest";
import {
  ACQUISITION_CHANNELS,
  UNKNOWN_CHANNEL,
  CHANNEL_KINDS,
  channelKindLabel,
} from "@/lib/acquisition-channel";
import {
  LOSS_REASON_KEYS,
  LOSS_REASON_KEY_LABELS,
  normalizeLossReason,
  lossReasonLabel,
} from "@/lib/loss-reason";

describe("acquisition-channel: catálogo", () => {
  it("canales semilla únicos por nombre y con kind válido", () => {
    const names = ACQUISITION_CHANNELS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of ACQUISITION_CHANNELS) {
      expect(CHANNEL_KINDS).toContain(c.kind);
    }
    // Los 16 canales pedidos + el reservado "Desconocido".
    expect(ACQUISITION_CHANNELS.length).toBe(16);
    expect(UNKNOWN_CHANNEL.kind).toBe("unknown");
  });
  it("etiqueta de kind válida; inválida → null", () => {
    expect(channelKindLabel("paid")).toBe("Pagado");
    expect(channelKindLabel("inventado")).toBeNull();
    expect(channelKindLabel(null)).toBeNull();
  });
});

describe("loss-reason: normalización", () => {
  it("claves únicas con etiqueta", () => {
    expect(new Set(LOSS_REASON_KEYS).size).toBe(LOSS_REASON_KEYS.length);
    for (const key of LOSS_REASON_KEYS) {
      expect(LOSS_REASON_KEY_LABELS[key]).toBeTruthy();
    }
  });
  it("mapea cada valor legado a su clave normalizada", () => {
    expect(normalizeLossReason("precio")).toBe("precio");
    expect(normalizeLossReason("nunca_contesto")).toBe("no_respondio");
    expect(normalizeLossReason("sin_presupuesto")).toBe("presupuesto_insuficiente");
    expect(normalizeLossReason("eligio_otro")).toBe("eligio_otro_proveedor");
    expect(normalizeLossReason("no_es_perfil")).toBe("fuera_de_alcance");
    expect(normalizeLossReason("otro")).toBe("otros");
  });
  it("una clave ya normalizada se conserva; desconocida o vacía cae en 'otros'", () => {
    expect(normalizeLossReason("tiempo_entrega")).toBe("tiempo_entrega");
    expect(normalizeLossReason("algo_raro")).toBe("otros");
    expect(normalizeLossReason(null)).toBe("otros");
    expect(normalizeLossReason("")).toBe("otros");
  });
  it("etiqueta de clave normalizada o de legado", () => {
    expect(lossReasonLabel("no_respondio")).toBe("No respondió");
    expect(lossReasonLabel("nunca_contesto")).toBe("No respondió");
    expect(lossReasonLabel(null)).toBeNull();
  });
});
