/**
 * Respaldo de los paneles de Inteligencia cuando la búsqueda no tiene datos.
 *
 * Regla del dueño: «aquí jamás dejen vacíos; si sobre el nicho no hay info,
 * muestren las tendencias del mismo giro con mayor alcance». El respaldo nunca
 * sustituye un dato por otro en silencio: cada fila cae en un nivel declarado y
 * la pantalla lo etiqueta. Tampoco inventa parentesco: un nivel solo se usa
 * cuando de verdad hay filas que lo cumplen, y si no hay ninguna se dice que el
 * país no tiene relación con el catálogo.
 *
 * Es puro y vive en `lib` para que el cliente lo use sin arrastrar la BD.
 */

import { matchedQueryWord, mentionsQuery, sharesWord } from "@/lib/intel-content";

export type FallbackCatalogTerm = {
  termId: string;
  name: string;
  keywords: readonly string[];
};

export type FallbackPrimary = {
  termId: string;
  name: string;
  keywords?: readonly string[];
};

/** Nicho del catálogo que explica una tendencia, con la palabra que la delata. */
export type RowNiche = {
  termId: string;
  name: string;
  via: string;
};

export type TrendFallbackLevel =
  | "todas"
  | "consulta"
  | "mismo-giro"
  | "catalogo"
  | "pais";

export type TrendFallbackRow<T> = {
  row: T;
  /** Nicho del catálogo al que pertenece la tendencia; null en el nivel país. */
  niche: RowNiche | null;
  level: TrendFallbackLevel;
};

export type TrendFallback<T> = {
  level: TrendFallbackLevel;
  rows: Array<TrendFallbackRow<T>>;
  /** Cuántas filas de la ventana mencionan la consulta. */
  matched: number;
  /** Nichos del mismo giro considerados; solo se listan si se usaron. */
  sameGiro: string[];
};

type TrendLike = { title: string; volume: number | null };

/**
 * Nicho del catálogo cuyo nombre o keyword aparece en el título. Recorre los
 * términos en el orden recibido (el servidor los manda de más a menos parecido
 * a la consulta), así que el nicho exacto gana sobre un vecino.
 */
export function nicheForTrend(
  title: string,
  terms: readonly FallbackCatalogTerm[]
): RowNiche | null {
  for (const term of terms) {
    for (const candidate of [term.name, ...term.keywords]) {
      const via = matchedQueryWord(title, candidate);
      if (via) return { termId: term.termId, name: term.name, via };
    }
  }
  return null;
}

/**
 * «Mismo giro» = nichos cuyo nombre comparte una palabra con el nombre o las
 * keywords del nicho principal («Cámaras IP» ↔ «Cámaras de seguridad»). No hay
 * campo `giro` en el catálogo y no se inventa: sin palabras en común no se
 * declara el parentesco, y el respaldo pasa al nivel siguiente.
 */
export function sameGiroTerms(
  terms: readonly FallbackCatalogTerm[],
  primary: FallbackPrimary | null | undefined
): FallbackCatalogTerm[] {
  if (!primary) return [];
  const basis = [primary.name, ...(primary.keywords ?? [])];
  return terms.filter(
    (term) =>
      term.termId !== primary.termId &&
      basis.some((phrase) => sharesWord(term.name, phrase))
  );
}

/** Mayor alcance primero: volumen descendente, sin volumen al final. */
function byReach<T extends TrendLike>(a: TrendFallbackRow<T>, b: TrendFallbackRow<T>): number {
  return (
    (b.row.volume ?? -1) - (a.row.volume ?? -1) ||
    a.row.title.localeCompare(b.row.title)
  );
}

/**
 * Elige el nivel de respaldo con el que la tabla nunca queda vacía si hay
 * filas ingeridas: coincidencias de la consulta → mismo giro → cualquier nicho
 * del catálogo → tendencias del país. Los niveles de respaldo se ordenan por
 * alcance, como pidió el dueño; las coincidencias conservan el orden elegido en
 * el panel.
 */
export function relateTrendRows<T extends TrendLike>(
  rows: readonly T[],
  query: string | null | undefined,
  terms: readonly FallbackCatalogTerm[],
  primary: FallbackPrimary | null | undefined
): TrendFallback<T> {
  const q = query?.trim() ?? "";
  const matchedRows = q ? rows.filter((row) => mentionsQuery(row.title, q)) : [];

  if (!q) {
    return {
      level: "todas",
      rows: rows.map((row) => ({
        row,
        niche: nicheForTrend(row.title, terms),
        level: "todas",
      })),
      matched: 0,
      sameGiro: [],
    };
  }

  if (matchedRows.length > 0) {
    return {
      level: "consulta",
      rows: matchedRows.map((row) => ({
        row,
        niche: nicheForTrend(row.title, terms),
        level: "consulta",
      })),
      matched: matchedRows.length,
      sameGiro: [],
    };
  }

  const sameGiro = sameGiroTerms(terms, primary);
  const tagged = rows.map((row) => ({
    row,
    niche: nicheForTrend(row.title, terms),
    level: "catalogo" as const,
  }));

  // El nicho principal entra en el mismo grupo aunque la consulta no aparezca:
  // sus propias keywords (p. ej. «camara ip» dentro de «Cámaras de
  // seguridad») describen su línea de negocio, que es el giro que se pide.
  const sameIds = new Set(sameGiro.map((term) => term.termId));
  if (primary) sameIds.add(primary.termId);
  if (sameIds.size > 0) {
    const same = tagged.filter((entry) => entry.niche && sameIds.has(entry.niche.termId));
    if (same.length > 0) {
      const anchors = [
        ...(primary ? [primary.name] : []),
        ...sameGiro.map((term) => term.name),
      ];
      return {
        level: "mismo-giro",
        rows: same
          .map((entry) => ({ ...entry, level: "mismo-giro" as const }))
          .sort(byReach),
        matched: 0,
        sameGiro: anchors,
      };
    }
  }

  const inCatalog = tagged.filter((entry) => entry.niche !== null);
  if (inCatalog.length > 0) {
    return {
      level: "catalogo",
      rows: [...inCatalog].sort(byReach),
      matched: 0,
      sameGiro: [],
    };
  }

  return {
    level: "pais",
    rows: tagged
      .map((entry) => ({ ...entry, niche: null, level: "pais" as const }))
      .sort(byReach),
    matched: 0,
    sameGiro: [],
  };
}

/* ── Señales para «Contenido que funciona» sin muestra de YouTube ───────── */

export type IntelSignalItem = {
  label: string;
  value: number;
  pct: number | null;
  list: "top" | "rising";
  isBreakout?: boolean;
};

export type IntelSignalSource = {
  /** De dónde salieron las señales, para citarlo en el panel. */
  origin: string;
  topics: readonly IntelSignalItem[];
  queries: readonly IntelSignalItem[];
};

export type IntelSignal = {
  key: string;
  label: string;
  kind: "tema" | "consulta";
  /** Índice 0–100 de Google Trends. */
  value: number;
  pct: number | null;
  rising: boolean;
  origin: string;
};

/**
 * Une temas y consultas de varias fuentes ya cargadas (nicho exacto y búsqueda
 * en vivo), sin repetir etiquetas y con las que están en alza primero. No
 * consulta la red: es el respaldo declarado cuando YouTube no tiene muestra.
 */
export function buildContentSignals(
  ...sources: Array<IntelSignalSource | null | undefined>
): IntelSignal[] {
  const byLabel = new Map<string, IntelSignal>();
  for (const source of sources) {
    if (!source) continue;
    const groups = [
      ["tema", source.topics],
      ["consulta", source.queries],
    ] as const;
    for (const [kind, items] of groups) {
      for (const item of items) {
        const label = item.label.trim();
        if (!label) continue;
        const key = label.toLocaleLowerCase("es");
        if (byLabel.has(key)) continue;
        byLabel.set(key, {
          key: `${kind}|${key}`,
          label,
          kind,
          value: item.value,
          pct: item.pct,
          rising: item.list === "rising" || Boolean(item.isBreakout),
          origin: source.origin,
        });
      }
    }
  }
  return [...byLabel.values()]
    .sort(
      (a, b) =>
        Number(b.rising) - Number(a.rising) ||
        b.value - a.value ||
        a.label.localeCompare(b.label)
    )
    .slice(0, 8);
}
