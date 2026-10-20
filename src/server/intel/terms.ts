import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Catálogo de términos (nichos) monitoreados por el módulo.
 *
 * En el primer uso de una organización se siembra una taxonomía inicial de
 * tecnología en México (los giros de Zorro Tech + retail tech), editable
 * después en la BD. El matching de videos es por keyword, no por nombre exacto.
 */

type SeedTerm = { name: string; keywords: string[] };

const SEED_TERMS: SeedTerm[] = [
  { name: "Cámaras de seguridad", keywords: ["camara de seguridad", "camaras de seguridad", "camara ip", "videovigilancia", "cctv"] },
  { name: "Cámaras IP", keywords: ["camara ip", "camaras ip", "camara de red", "nvr", "dvr"] },
  { name: "Redes y conectividad", keywords: ["router", "switch de red", "punto de acceso", "wifi", "redes"] },
  { name: "Alarmas y sensores", keywords: ["alarma para casa", "alarma inalambrica", "sensor de movimiento", "sensor de puerta"] },
  { name: "Energía solar", keywords: ["panel solar", "energia solar", "inversor solar", "bateria litio"] },
  { name: "Herramienta eléctrica", keywords: ["taladro", "herramienta electrica", "megafresa", "amoladora", "remachadora", "multimetro"] },
  { name: "Pro Audio / Video", keywords: ["proyector", "pantalla led", "bocina profesional", "micrófono inalambrico", "mezcladora de audio"] },
  { name: "Computo de escritorio", keywords: ["pc gamer", "computadora para oficina", "armar pc", "tarjeta de video", "gabinete"] },
  { name: "Laptops", keywords: ["laptop", "portatil", "macbook", "chromebook"] },
  { name: "Smartphones", keywords: ["celular", "smartphone", "iphone", "samsung galaxy", "xiaomi"] },
  { name: "Accesorios de celular", keywords: ["carga inalambrica", "funda para celular", "audifonos true wireless", "cable usb"] },
  { name: "Impresión 3D", keywords: ["impresora 3d", "filamento pla", "resina para impresion", "ender"] },
  { name: "Internet satelital", keywords: ["starlink", "internet satelital", "antena satelital"] },
  { name: "Domótica", keywords: ["casa inteligente", "domotica", "bombilla inteligente", "enchufe inteligente"] },
  { name: "Gaming", keywords: ["playstation", "xbox", "nintendo switch", "silla gamer", "teclado mecanico"] },
];

export type IntelTerm = {
  id: string;
  name: string;
  keywords: string[];
  geo: string;
  active: boolean;
};

type Row = typeof schema.intelTerm.$inferSelect;

function toTerm(row: Row): IntelTerm {
  return {
    id: row.id,
    name: row.name,
    keywords: Array.isArray(row.keywords)
      ? row.keywords.filter((k): k is string => typeof k === "string")
      : [],
    geo: row.geo,
    active: row.active,
  };
}

/** Siembra la taxonomía inicial solo si la organización no tiene términos. */
export async function ensureSeedTerms(organizationId: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: schema.intelTerm.id })
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(schema.intelTerm).values(
    SEED_TERMS.map((term) => ({
      id: newId("intelTerm"),
      organizationId,
      name: term.name,
      keywords: term.keywords,
      geo: "MX",
      active: true,
    }))
  );
}

export async function listActiveTerms(
  organizationId: string
): Promise<IntelTerm[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.active, true)));
  return rows.map(toTerm);
}

export async function listTerms(organizationId: string): Promise<IntelTerm[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId))
    .orderBy(schema.intelTerm.name);
  return rows.map(toTerm);
}

/**
 * Resuelve una búsqueda libre a un término del catálogo y con cuánta similitud
 * coincide. `null` = la consulta no es ningún nicho monitoreado.
 */
export async function resolveTerm(
  organizationId: string,
  query: string
): Promise<{ term: IntelTerm; match: TermMatch } | null> {
  const terms = await listActiveTerms(organizationId);
  const match = matchTerm(terms, query);
  if (!match) return null;
  const term = terms.find((t) => t.id === match.id);
  return term ? { term, match } : null;
}

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "y", "o", "a", "al", "en", "con", "por", "para", "que", "su", "se",
  "lo", "es",
]);

/** Sin acentos ni puntuación, en minúsculas. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Tokens comparables de una frase: palabras de 2+ letras, sin acentos ni vacías. */
export function matchTokens(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * ¿Son la misma palabra? Acepta el plural español ("-es" tras consonante,
 * "-s" restante) y el inglés, sin stemming: "celulares"≡"celular",
 * "smartphones"≡"smartphone", "redes"≡"red".
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (!long.startsWith(short)) return false;
  const extra = long.length - short.length;
  if (extra === 1) return long.endsWith("s");
  if (extra === 2) return long.endsWith("es");
  return false;
}

/** Similitud 0-1 entre dos frases: tokens compartidos sobre el total distinto. */
export function termSimilarity(a: string, b: string): number {
  const left = matchTokens(a);
  const right = matchTokens(b);
  if (left.length === 0 || right.length === 0) return 0;
  const taken = new Set<number>();
  let shared = 0;
  for (const token of left) {
    for (let i = 0; i < right.length; i++) {
      const other = right[i];
      if (other === undefined || taken.has(i)) continue;
      if (sameWord(token, other)) {
        taken.add(i);
        shared++;
        break;
      }
    }
  }
  const union = left.length + right.length - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Umbral de similitud para asignar una búsqueda a un término del catálogo.
 * 0.6 descarta coincidencias parciales: "redes sociales" (2 tokens) contra la
 * keyword "redes" (1 token) queda en 0.5 y NO hereda el nicho de conectividad.
 */
export const TERM_MATCH_MIN = 0.6;

export type TermMatch = {
  id: string;
  name: string;
  score: number;
  /** Texto del catálogo con el que coincidió (nombre o keyword). */
  via: string;
};

/**
 * ¿Esta búsqueda ES un nicho del catálogo? Puntúa todos los términos y gana el
 * más parecido, sin pasar del umbral. Sustituye la subcadena bidireccional,
 * que heredaba la data cacheada de otro nicho a búsquedas distintas
 * ("redes sociales" caía en "Redes y conectividad").
 */
export function matchTerm(
  terms: Array<{ id: string; name: string; keywords: string[] }>,
  keyword: string
): TermMatch | null {
  if (matchTokens(keyword).length === 0) return null;
  let best: TermMatch | null = null;
  for (const term of terms) {
    const candidates = [term.name, ...term.keywords];
    for (const candidate of candidates) {
      if (!candidate.trim()) continue;
      const score = termSimilarity(keyword, candidate);
      if (score < TERM_MATCH_MIN) continue;
      if (!best || score > best.score) {
        best = { id: term.id, name: term.name, score, via: candidate };
      }
    }
  }
  return best;
}

/**
 * Versión sin metadatos de matchTerm: la usa /api/intel/monitor para no
 * duplicar el catálogo. Misma regla estricta, así que una keyword nueva se
 * registra como nicho propio en vez de heredar el parecido de otro.
 */
export function findTermByKeyword(
  terms: Array<{ id: string; name: string; keywords: string[] }>,
  keyword: string
): { id: string; name: string } | null {
  const hit = matchTerm(terms, keyword);
  if (!hit) return null;
  return { id: hit.id, name: hit.name };
}
