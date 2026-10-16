/**
 * 016 — Productores de `attribution_event` (first/last touch).
 *
 * La tabla ya existía y ya la leían el dashboard y el reporte comercial
 * (`dashboard/query.ts`, `commercial/query.ts:224-235`), pero NADIE la
 * escribía: todos esos KPIs daban cero. Este módulo es el productor único.
 *
 * Tres hechos, tres vocabularios, sin inventar origen donde no lo hay:
 *  - `anuncio`      — llegó un referral de Meta (ctwa_clid). Lo más rico.
 *  - `declarado`    — el dueño dio de alta el contacto con fuente/medio.
 *  - `canal`        — solo se sabe por qué canal entró (WhatsApp, IG…).
 *
 * Idempotencia: el primer toque está protegido por el índice único PARCIAL
 * `attribution_event_first_uq` (org + contacto donde touch_type='first'),
 * así que dos webhooks simultáneos no pueden anotar dos primeros toques.
 * El último toque sí es de-insertar (son eventos, no estados).
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { ACQUISITION_CHANNELS } from "@/lib/acquisition-channel";
import { hasUtm, parseUtmParams, type UtmParams } from "@/lib/utm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type TouchType = "first" | "last";

export type AttributionKind = "anuncio" | "declarado" | "canal";

/** Canal del catálogo al que equivale cada canal de contacto de la bandeja. */
const CHANNEL_BY_CONTACT_CHANNEL: Record<string, string> = {
  whatsapp: "whatsapp_directo",
  instagram: "instagram_organico",
  messenger: "facebook_organico",
  facebook: "facebook_organico",
  tiktok: "tiktok_organico",
};

type InsertTouchInput = {
  organizationId: string;
  contactId: string;
  conversationId?: string | null;
  touchType: TouchType;
  attributionKind: AttributionKind;
  channelId?: string | null;
  clickId?: string | null;
  source?: string | null;
  medium?: string | null;
  campaignName?: string | null;
  utms?: UtmParams;
  occurredAt?: Date;
};

/** Inserta el toque. `false` = ya existía el primero (índice parcial). */
async function insertTouch(db: Db, input: InsertTouchInput): Promise<boolean> {
  const utm = input.utms ?? null;
  const rows = await db
    .insert(schema.attributionEvent)
    .values({
      id: newId("attributionEvent"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      channelId: input.channelId ?? null,
      touchType: input.touchType,
      attributionType: input.attributionKind,
      source: input.source ?? null,
      medium: input.medium ?? null,
      campaignName: input.campaignName ?? null,
      utmSource: utm?.utmSource ?? null,
      utmMedium: utm?.utmMedium ?? null,
      utmCampaign: utm?.utmCampaign ?? null,
      utmContent: utm?.utmContent ?? null,
      utmTerm: utm?.utmTerm ?? null,
      clickId: input.clickId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.attributionEvent.id });
  return Boolean(rows[0]);
}

/** Resuelve el canal del catálogo por su `key` (el catálogo va por nombre). */
async function resolveChannelByKey(
  db: Db,
  organizationId: string,
  key: string
): Promise<string | null> {
  const seed = ACQUISITION_CHANNELS.find((c) => c.key === key);
  if (!seed) return null;
  const [row] = await db
    .select({ id: schema.acquisitionChannel.id })
    .from(schema.acquisitionChannel)
    .where(
      and(
        eq(schema.acquisitionChannel.organizationId, organizationId),
        eq(schema.acquisitionChannel.name, seed.name)
      )
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Rellena `contact.acquisitionChannelId` solo si estaba vacío: el primer canal
 * que se prueba es el que queda. Si ya el dueño lo asignó, no se pisa.
 */
async function claimContactChannel(
  db: Db,
  organizationId: string,
  contactId: string,
  channelId: string
): Promise<boolean> {
  const [contact] = await db
    .select({ acquisitionChannelId: schema.contact.acquisitionChannelId })
    .from(schema.contact)
    .where(and(eq(schema.contact.id, contactId), eq(schema.contact.organizationId, organizationId)))
    .limit(1);
  if (!contact || contact.acquisitionChannelId) return false;
  await db
    .update(schema.contact)
    .set({ acquisitionChannelId: channelId, updatedAt: new Date() })
    .where(eq(schema.contact.id, contactId));
  return true;
}

function referralFacts(referral: {
  ctwa_clid?: string;
  source_id?: string;
  source_url?: string;
  headline?: string;
}) {
  const utms = parseUtmParams(referral.source_url);
  return {
    clickId: referral.ctwa_clid ?? null,
    campaignName: referral.headline ?? referral.source_id ?? null,
    // Los UTM del anuncio mandan sobre el adivinado: si no, el clic de Meta.
    source: (hasUtm(utms) ? utms.utmSource : null) ?? "whatsapp",
    medium: (hasUtm(utms) ? utms.utmMedium : null) ?? "clic",
    utms,
  };
}

/**
 * Primer toque: se registra al nacer la oportunidad del contacto, en el único
 * embudo por el que pasa TODO lead (webhook, alta manual e import).
 *
 * No revienta nunca: la atribución es best-effort igual que los webhooks.
 */
export async function recordLeadFirstTouch(input: {
  db?: Db;
  organizationId: string;
  contactId: string;
  conversationId?: string | null;
  referral?: {
    ctwa_clid?: string;
    source_id?: string;
    source_url?: string;
    headline?: string;
  } | null;
  occurredAt?: Date;
}): Promise<boolean> {
  try {
    const db = input.db ?? getDb();

    const [contact] = await db
      .select({
        channel: schema.contact.channel,
        source: schema.contact.source,
        medium: schema.contact.medium,
        acquisitionChannelId: schema.contact.acquisitionChannelId,
      })
      .from(schema.contact)
      .where(eq(schema.contact.id, input.contactId))
      .limit(1);
    if (!contact) return false;

    // El referral llega con el mensaje en la bandeja, no con el alta del lead:
    // si aquí no vino, se busca el que Meta dejó registrado para este contacto
    // (`ad_attribution`) para no perder el clic de la primera vez.
    let referral = input.referral ?? null;
    if (!referral) {
      const [ad] = await db
        .select({
          ctwaClid: schema.adAttribution.ctwaClid,
          sourceId: schema.adAttribution.sourceId,
          sourceUrl: schema.adAttribution.sourceUrl,
          headline: schema.adAttribution.headline,
        })
        .from(schema.adAttribution)
        .where(eq(schema.adAttribution.contactId, input.contactId))
        .limit(1);
      if (ad && (ad.ctwaClid || ad.sourceId || ad.sourceUrl)) {
        referral = {
          ctwa_clid: ad.ctwaClid ?? undefined,
          source_id: ad.sourceId ?? undefined,
          source_url: ad.sourceUrl ?? undefined,
          headline: ad.headline ?? undefined,
        };
      }
    }

    let channelId: string | null = contact.acquisitionChannelId;
    let facts: {
      clickId: string | null;
      campaignName: string | null;
      source: string | null;
      medium: string | null;
      utms: UtmParams;
    };

    if (referral?.ctwa_clid || referral?.source_id) {
      facts = referralFacts(referral);
      const metaAds = await resolveChannelByKey(db, input.organizationId, "meta_ads");
      if (metaAds && !channelId) {
        channelId = metaAds;
        await claimContactChannel(db, input.organizationId, input.contactId, metaAds);
      }
    } else if (contact.source || contact.medium) {
      facts = {
        clickId: null,
        campaignName: null,
        source: contact.source,
        medium: contact.medium,
        utms: parseUtmParams(null),
      };
    } else {
      const key = CHANNEL_BY_CONTACT_CHANNEL[contact.channel] ?? "desconocido";
      facts = {
        clickId: null,
        campaignName: null,
        source: key,
        medium: "canal",
        utms: parseUtmParams(null),
      };
      if (!channelId) {
        const resolved = await resolveChannelByKey(db, input.organizationId, key);
        if (resolved) {
          channelId = resolved;
          await claimContactChannel(db, input.organizationId, input.contactId, resolved);
        }
      }
    }

    const kind: AttributionKind = referral?.ctwa_clid
      ? "anuncio"
      : contact.source || contact.medium
        ? "declarado"
        : "canal";

    return await insertTouch(db, {
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      touchType: "first",
      attributionKind: kind,
      channelId,
      clickId: facts.clickId,
      source: facts.source,
      medium: facts.medium,
      campaignName: facts.campaignName,
      utms: facts.utms,
      occurredAt: input.occurredAt,
    });
  } catch (err) {
    console.error("[attribution] No se pudo registrar el primer toque:", err);
    return false;
  }
}

/**
 * Último toque desde un anuncio de Meta (llega con el mensaje en la bandeja).
 * Puede llevar UTMs si la URL del anuncio las trae.
 */
export async function recordReferralTouch(input: {
  organizationId: string;
  contactId: string;
  conversationId?: string | null;
  referral: {
    ctwa_clid?: string;
    source_id?: string;
    source_url?: string;
    headline?: string;
  };
  occurredAt?: Date;
}): Promise<void> {
  try {
    const db = getDb();
    const facts = referralFacts(input.referral);
    const metaAds = await resolveChannelByKey(db, input.organizationId, "meta_ads");
    if (metaAds) await claimContactChannel(db, input.organizationId, input.contactId, metaAds);

    await insertTouch(db, {
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      touchType: "last",
      attributionKind: input.referral.ctwa_clid ? "anuncio" : "declarado",
      channelId: metaAds,
      clickId: facts.clickId,
      source: facts.source,
      medium: facts.medium,
      campaignName: facts.campaignName,
      utms: facts.utms,
      occurredAt: input.occurredAt,
    });
  } catch (err) {
    console.error("[attribution] No se pudo registrar el toque del anuncio:", err);
  }
}

/** Último toque cuando el dueño da de alta un contacto con fuente/medio. */
export async function recordDeclaredTouch(input: {
  organizationId: string;
  contactId: string;
  source?: string | null;
  medium?: string | null;
  channelId?: string | null;
  occurredAt?: Date;
}): Promise<void> {
  if (!input.source && !input.medium) return;
  try {
    const db = getDb();
    await insertTouch(db, {
      organizationId: input.organizationId,
      contactId: input.contactId,
      touchType: "last",
      attributionKind: "declarado",
      channelId: input.channelId ?? null,
      source: input.source ?? null,
      medium: input.medium ?? null,
      occurredAt: input.occurredAt,
    });
  } catch (err) {
    console.error("[attribution] No se pudo registrar el toque declarado:", err);
  }
}
