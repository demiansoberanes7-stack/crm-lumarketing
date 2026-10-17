import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { eq, gte, lte } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { z } from "zod";

export const dynamic = "force-dynamic";

const googleAdsMetricCreateSchema = z.object({
  campaignId: z.string().min(1).max(255),
  adGroupId: z.string().max(255).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impressions: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  costCents: z.number().int().nonnegative().default(0),
  conversions: z.number().nonnegative().default(0),
  currency: z.string().max(10).default("MXN"),
});

/**
 * Métricas de Google Ads.
 * GET  /api/google-ads/metrics?from=2024-01-01&to=2024-12-31&campaignId=xxx
 * POST /api/google-ads/metrics  → upsert métricas
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const campaignId = url.searchParams.get("campaignId")?.trim() || null;

  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return apiError(422, "invalid_date", "Fecha 'from' inválida (YYYY-MM-DD)");
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return apiError(422, "invalid_date", "Fecha 'to' inválida (YYYY-MM-DD)");
  }

  const db = getDb();
  const conditions = [];
  if (from) conditions.push(gte(schema.googleAdsMetric.date, from));
  if (to) conditions.push(lte(schema.googleAdsMetric.date, to));
  if (campaignId) conditions.push(eq(schema.googleAdsMetric.campaignId, campaignId));

  const metrics = await db
    .select()
    .from(schema.googleAdsMetric)
    .where(
      scoped(schema.googleAdsMetric.organizationId, session.organizationId, ...conditions)
    )
    .orderBy(schema.googleAdsMetric.date)
    .limit(1000);

  return Response.json({ metrics });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => null);
  const parsed = googleAdsMetricCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const db = getDb();
  const { campaignId, adGroupId, date, impressions, clicks, costCents, conversions, currency } = parsed.data;

  // Upsert: si ya existe métrica para (org, campaignId, adGroupId, date), actualizar
  const [existing] = await db
    .select({ id: schema.googleAdsMetric.id })
    .from(schema.googleAdsMetric)
    .where(
      scoped(
        schema.googleAdsMetric.organizationId,
        session.organizationId,
        eq(schema.googleAdsMetric.campaignId, campaignId),
        eq(schema.googleAdsMetric.date, date),
        adGroupId
          ? eq(schema.googleAdsMetric.adGroupId, adGroupId)
          : eq(schema.googleAdsMetric.adGroupId, null as unknown as string)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.googleAdsMetric)
      .set({
        impressions,
        clicks,
        costCents,
        conversions,
        currency,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleAdsMetric.id, existing.id));
    const [updated] = await db
      .select()
      .from(schema.googleAdsMetric)
      .where(eq(schema.googleAdsMetric.id, existing.id))
      .limit(1);
    return Response.json({ metric: updated });
  }

  const id = newId("googleAdsMetric");
  await db.insert(schema.googleAdsMetric).values({
    id,
    organizationId: session.organizationId,
    campaignId,
    adGroupId: adGroupId ?? null,
    date,
    impressions,
    clicks,
    costCents,
    conversions,
    currency,
  });

  const [metric] = await db
    .select()
    .from(schema.googleAdsMetric)
    .where(eq(schema.googleAdsMetric.id, id))
    .limit(1);

  return Response.json({ metric }, { status: 201 });
});
