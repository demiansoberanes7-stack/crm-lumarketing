import { describe, expect, it } from "vitest";
import { buildDraft } from "@/components/agenda/agenda-form";

/**
 * El instante que manda el formulario de «Nueva cita».
 *
 * Era la única forma de que una cita creada a mano llegara corrida de hora: un
 * hueco de la disponibilidad ya viene en UTC, pero `<input type="time">` escribe
 * la hora del OPERADOR sin zona. En el fork se leía con la zona del navegador,
 * así que un negocio de Ciudad de México visto desde Madrid agendaba seis horas
 * antes. Ahora la hora de pared se interpreta SIEMPRE en la zona del calendario,
 * que es la misma con la que la rejilla está pintada.
 *
 * Se prueba con zonas y fechas fijas, no contra el reloj local: si dependiera de
 * dónde corra Vitest, el test pasaría en el CI y mentiría en el portátil.
 */

const base = {
  kind: "session" as const,
  contactId: "ct_1",
  day: "2026-08-05",
  start: "09:00",
  durationMinutes: 30,
  title: "  Revisión de propuesta  ",
  location: "  Videollamada  ",
  notes: "   ",
  timezone: "America/Mexico_City",
};

describe("buildDraft", () => {
  it("la hora tecleada se interpreta en la zona del calendario", () => {
    // CDMX es UTC-6 todo el año (sin horario de verano desde 2022).
    expect(buildDraft(base)).toEqual({
      ok: true,
      draft: {
        kind: "session",
        contactId: "ct_1",
        startUtc: "2026-08-05T15:00:00.000Z",
        durationMinutes: 30,
        title: "Revisión de propuesta",
        location: "Videollamada",
        notes: null,
      },
    });
  });

  it("misma hora, otra zona: otro instante. Nadie comparte horario", () => {
    const bogota = buildDraft({ ...base, timezone: "America/Bogota" });
    expect(bogota.ok && bogota.draft.startUtc).toBe("2026-08-05T14:00:00.000Z");
    const madrid = buildDraft({ ...base, timezone: "Europe/Madrid" });
    expect(madrid.ok && madrid.draft.startUtc).toBe("2026-08-05T07:00:00.000Z");
  });

  it("un bloqueo no es una reunión con nadie: sin contacto ni motivo", () => {
    const draft = buildDraft({
      ...base,
      kind: "block",
      title: "no aplica",
      contactId: "ct_1",
    });
    expect(draft.ok && draft.draft.contactId).toBeNull();
    expect(draft.ok && draft.draft.title).toBeNull();
    expect(draft.ok && draft.draft.startUtc).toBe("2026-08-05T15:00:00.000Z");
  });

  it("nada de horas inventadas: sin fecha, sin hora o ilegible, no se manda", () => {
    expect(buildDraft({ ...base, day: "" })).toEqual({
      ok: false,
      error: "Falta la fecha.",
    });
    expect(buildDraft({ ...base, day: "5/8/2026" }).ok).toBe(false);
    expect(buildDraft({ ...base, start: "" }).ok).toBe(false);
    // «24:00» no existe como hora de pared y «9:7» no es HH:MM.
    expect(buildDraft({ ...base, start: "24:00" }).ok).toBe(false);
    expect(buildDraft({ ...base, start: "9:7" }).ok).toBe(false);
  });

  it("la duración se acota antes de salir: lo que el servidor rechaza no se envía", () => {
    expect(buildDraft({ ...base, durationMinutes: 0 }).ok).toBe(false);
    expect(buildDraft({ ...base, durationMinutes: 4 }).ok).toBe(false);
    expect(buildDraft({ ...base, durationMinutes: 601 }).ok).toBe(false);
    expect(buildDraft({ ...base, durationMinutes: 600 }).ok).toBe(true);
  });

  it("una zona horaria que el runtime no conoce no produce instante", () => {
    // `Intl` lanza RangeError con un nombre inválido; `zonedInputToUtc` lo
    // convierte en null y el formulario lo dice en palabras en vez de reventar
    // el submit. Las rutas ya rechazan esa zona al guardar, pero la fila puede
    // venir sucia de otra instancia.
    expect(buildDraft({ ...base, timezone: "No/Existe" })).toEqual({
      ok: false,
      error:
        "La zona del calendario no es válida: corrígela en Ajustes → Agenda.",
    });
    expect(buildDraft({ ...base, timezone: "" }).ok).toBe(false);
  });
});
