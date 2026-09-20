/**
 * Patrón de RESPALDO de intención de escalado (FR-022). Se evalúa sobre el
 * mensaje del cliente ANTES del LLM: si matchea, el handoff ocurre aunque el
 * modelo no lo detecte. Diseñado para exigir un verbo de contacto cerca del
 * objeto humano — "somos 4 personas" NO matchea (test unitario).
 */
export const HANDOFF_BACKUP_REGEX =
  /(hablar|comunicar|contactar)[\s\S]{0,40}?(asesor|humano|persona|alguien)|un asesor|atenci[oó]n humana/i;

export function matchesHandoffIntent(text: string): boolean {
  return HANDOFF_BACKUP_REGEX.test(text);
}

/**
 * Keywords configurables del pipeline. Formato del campo:
 *   "cotización → Cotización\nperdido → Perdido"
 *
 * Devuelve el nombre de la etapa si el texto contiene alguna keyword, o null.
 */
export function matchesPipelineKeyword(
  text: string,
  pipelineKeywords: string | null
): string | null {
  if (!pipelineKeywords?.trim()) return null;
  const lower = text.toLowerCase();
  const lines = pipelineKeywords.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("→")) continue;
    const [keyword, stage] = trimmed.split("→").map((s) => s.trim());
    if (keyword && stage && lower.includes(keyword.toLowerCase())) {
      return stage;
    }
  }
  return null;
}
