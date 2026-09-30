/**
 * Estado en memoria del sink de webhooks de salida (solo dev/test).
 *
 * El E2E registra el CRM como destino de sus propios webhooks y luego necesita
 * ver qué llegó: este buffer es el receptor. Vive en globalThis porque Next
 * recarga módulos en dev.
 */

export type SinkEntry = {
  n: number;
  at: string;
  event: string;
  signature: string | null;
  deliveryId: string | null;
  idempotencyKey: string | null;
  payload: unknown;
  /** Cuerpo exacto que llegó: con él el guión revalida la firma HMAC. */
  raw: string;
};

const MAX_ENTRIES = 50;

type SinkState = { entries: SinkEntry[]; seq: number };

function state(): SinkState {
  const g = globalThis as { __webhookSink?: SinkState };
  g.__webhookSink ??= { entries: [], seq: 0 };
  return g.__webhookSink;
}

export function recordSinkEntry(
  entry: Omit<SinkEntry, "n" | "at">
): SinkEntry {
  const s = state();
  s.seq += 1;
  const row: SinkEntry = { n: s.seq, at: new Date().toISOString(), ...entry };
  s.entries.push(row);
  if (s.entries.length > MAX_ENTRIES) {
    s.entries.splice(0, s.entries.length - MAX_ENTRIES);
  }
  return row;
}

export function getSinkEntries(): SinkEntry[] {
  return state().entries;
}

export function clearSink(): void {
  state().entries = [];
}
