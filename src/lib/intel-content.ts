/**
 * Ideas de contenido para la palabra buscada.
 *
 * El ranking de nichos monitoreados no sirve aquí: si el operador busca
 * «cámara lenta», la recomendación semanal debe salir de las consultas y temas
 * relacionados que Google Trends devolvió para ESA búsqueda. Estas funciones
 * son puras para poder probarlas sin red ni React.
 */

export type MarketIdea = {
  label: string;
  value: number;
  pct: number | null;
  isBreakout: boolean;
  list: "top" | "rising";
};

export type ContentTone = "success" | "warning" | "danger" | "neutral";

export type KeywordIdea = {
  key: string;
  name: string;
  kind: "consulta" | "tema";
  /** Índice relativo 0–100 que devuelve Google Trends. */
  value: number;
  pct: number | null;
  rising: boolean;
  recommendation: string;
  tone: ContentTone;
};

const MAX_IDEAS = 8;

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase("es");
}

function ideaFrom(item: MarketIdea, kind: KeywordIdea["kind"]): KeywordIdea {
  const rising = item.list === "rising" || item.isBreakout;
  const recommendation = item.isBreakout
    ? "Publicar ahora — aumento puntual de búsquedas"
    : item.list === "rising"
      ? "Publicar ahora — búsqueda en alza"
      : item.value >= 50
        ? "Mantener — consulta principal"
        : item.value >= 15
          ? "Explorar — interés medio"
          : "Opcional — interés bajo";
  return {
    key: `${kind}|${normalizeLabel(item.label)}`,
    name: item.label.trim(),
    kind,
    value: item.value,
    pct: item.pct,
    rising,
    recommendation,
    tone: rising ? "success" : "neutral",
  };
}

/**
 * Combina consultas y temas relacionados de la búsqueda, sin repetir etiquetas
 * (la consulta gana sobre el tema) y con las que están en alza primero.
 */
export function buildKeywordIdeas(input: {
  queries: readonly MarketIdea[];
  topics: readonly MarketIdea[];
}): KeywordIdea[] {
  const byLabel = new Map<string, KeywordIdea>();
  for (const item of input.queries) {
    if (!item.label.trim()) continue;
    const idea = ideaFrom(item, "consulta");
    if (!byLabel.has(normalizeLabel(idea.name))) byLabel.set(normalizeLabel(idea.name), idea);
  }
  for (const item of input.topics) {
    if (!item.label.trim()) continue;
    const key = normalizeLabel(item.label);
    if (byLabel.has(key)) continue;
    byLabel.set(key, ideaFrom(item, "tema"));
  }
  return [...byLabel.values()]
    .sort((a, b) => {
      if (a.rising !== b.rising) return a.rising ? -1 : 1;
      if (a.rising && b.rising) {
        return (b.pct ?? -1) - (a.pct ?? -1) || b.value - a.value;
      }
      return b.value - a.value;
    })
    .slice(0, MAX_IDEAS);
}

export type KeywordTrend = {
  /** Último índice de interés (0–100). */
  index: number;
  direction: "up" | "down" | "flat";
  changePct: number | null;
  recommendation: string;
  tone: ContentTone;
};

/**
 * Tendencia de la palabra buscada: media de los últimos 7 días contra los 7
 * anteriores. Sin 14 puntos no se inventa dirección: queda plana.
 */
export function keywordInterestTrend(
  series: ReadonlyArray<{ day: string; value: number }>
): KeywordTrend | null {
  if (series.length === 0) return null;
  const values = series.map((point) => point.value);
  const index = values[values.length - 1] ?? 0;
  let direction: KeywordTrend["direction"] = "flat";
  let changePct: number | null = null;

  if (values.length >= 14) {
    const recentValues = values.slice(-7);
    const priorValues = values.slice(-14, -7);
    const recent = recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length;
    const prior = priorValues.reduce((sum, value) => sum + value, 0) / priorValues.length;
    if (prior > 0) {
      changePct = Math.round(((recent - prior) / prior) * 100);
      direction = changePct >= 15 ? "up" : changePct <= -15 ? "down" : "flat";
    } else if (recent > 0) {
      direction = "up";
    }
  }

  const recommendation =
    direction === "up"
      ? "Publicar ahora — interés en alza"
      : direction === "down"
        ? "Reducir — interés a la baja"
        : index >= 50
          ? "Mantener — interés alto y estable"
          : index >= 15
            ? "Mantener — interés estable"
            : "Explorar — interés bajo";

  return {
    index,
    direction,
    changePct,
    recommendation,
    tone: direction === "up" ? "success" : direction === "down" ? "danger" : "neutral",
  };
}
