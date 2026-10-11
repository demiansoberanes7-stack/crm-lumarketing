import { desc } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  googleBusinessDisabledResponse,
  googleBusinessEnabled,
} from "@/server/google-business/flag";

export const dynamic = "force-dynamic";

/** Locales y reseñas sincronizadas, para la pestaña de Configuración. */
export const GET = withAuth(async (session) => {
  if (!googleBusinessEnabled()) return googleBusinessDisabledResponse();
  const db = getDb();
  const locations = await db
    .select()
    .from(schema.googleBusinessLocation)
    .where(scoped(schema.googleBusinessLocation.organizationId, session.organizationId))
    .orderBy(schema.googleBusinessLocation.displayName);
  const reviews = await db
    .select()
    .from(schema.googleBusinessReview)
    .where(scoped(schema.googleBusinessReview.organizationId, session.organizationId))
    .orderBy(desc(schema.googleBusinessReview.createTime))
    .limit(100);
  return Response.json({
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      displayName: l.displayName,
      averageRating: l.averageRating,
      reviewCount: l.reviewCount,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      locationId: r.locationId,
      reviewName: r.reviewName,
      reviewerName: r.reviewerName,
      rating: r.rating,
      comment: r.comment,
      createTime: r.createTime,
      replyComment: r.replyComment,
      repliedAt: r.repliedAt,
    })),
  });
});
