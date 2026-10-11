import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { publish } from "@/server/events/bus";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import {
  exchangeAccessToken,
  listAccounts,
  listLocations,
  listReviews,
  type GbLocation,
  type GbReview,
} from "@/server/google-business/google-api";
import {
  getGoogleBusinessCredentials,
  markGoogleBusinessError,
  markGoogleBusinessSynced,
} from "@/server/google-business/credentials";

/**
 * Sync de Google Business Profile: ubica locales → reseñas → las ingesta en
 * la Bandeja como canal `google_business`.
 *
 * Idempotencia (constitución IV): `review_name` es UNIQUE por org; el upsert
 * de reseñas es por ese campo, y el mensaje entrante usa el resource name
 * como `wa_message_id`, así que un segundo poller no duplica nada.
 */

export type SyncResult = {
  locations: number;
  reviews: number;
  newReviews: number;
};

export function reviewStarsText(rating: number): string {
  const stars = Math.min(5, Math.max(0, Math.round(rating)));
  return "★".repeat(stars) || "Sin estrellas";
}

/** Texto del mensaje entrante en la Bandeja: estrellas + comentario. */
export function reviewMessageText(review: GbReview): string {
  const header = `${reviewStarsText(review.rating)} · ${review.reviewerName ?? "Reseña anónima"}`;
  return review.comment ? `${header}\n\n${review.comment}` : header;
}

async function upsertLocation(organizationId: string, loc: GbLocation): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: schema.googleBusinessLocation.id })
    .from(schema.googleBusinessLocation)
    .where(
      and(
        eq(schema.googleBusinessLocation.organizationId, organizationId),
        eq(schema.googleBusinessLocation.name, loc.name)
      )
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.googleBusinessLocation)
      .set({
        displayName: loc.displayName,
        averageRating: loc.averageRating != null ? String(loc.averageRating.toFixed(2)) : null,
        reviewCount: loc.reviewCount,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleBusinessLocation.id, existing[0].id));
    return existing[0].id;
  }
  const id = newId("googleBusinessLocation");
  await db.insert(schema.googleBusinessLocation).values({
    id,
    organizationId,
    name: loc.name,
    displayName: loc.displayName,
    averageRating: loc.averageRating != null ? String(loc.averageRating.toFixed(2)) : null,
    reviewCount: loc.reviewCount,
  });
  return id;
}

/**
 * Upsert de la reseña + su ingest en la Bandeja. Devuelve true si la reseña
 * era NUEVA (para contar `newReviews`).
 */
async function upsertReviewIntoInbox(input: {
  organizationId: string;
  locationId: string;
  review: GbReview;
}): Promise<boolean> {
  const db = getDb();
  const { organizationId, locationId, review } = input;

  const existing = await db
    .select({ id: schema.googleBusinessReview.id, replyComment: schema.googleBusinessReview.replyComment })
    .from(schema.googleBusinessReview)
    .where(
      and(
        eq(schema.googleBusinessReview.organizationId, organizationId),
        eq(schema.googleBusinessReview.reviewName, review.name)
      )
    )
    .limit(1);

  const isNew = !existing[0];
  const repliedAt = review.replyComment ? new Date() : null;
  if (isNew) {
    await db.insert(schema.googleBusinessReview).values({
      id: newId("googleBusinessReview"),
      organizationId,
      locationId,
      reviewName: review.name,
      reviewerName: review.reviewerName,
      rating: review.rating,
      comment: review.comment,
      createTime: new Date(review.createTime),
      updateTime: review.updateTime ? new Date(review.updateTime) : null,
      replyComment: review.replyComment,
      repliedAt,
    });
  } else {
    await db
      .update(schema.googleBusinessReview)
      .set({
        reviewerName: review.reviewerName,
        rating: review.rating,
        comment: review.comment,
        updateTime: review.updateTime ? new Date(review.updateTime) : null,
        replyComment: review.replyComment,
        repliedAt: review.replyComment ? repliedAt ?? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleBusinessReview.id, existing[0]!.id));
  }

  // ── Ingest en la Bandeja ──
  // Identidad: `gb:<nombre del reviewer>` (anónimos comparten "anonimo" — son
  // pocas reseñas anónimas y el operador las distingue por el texto).
  const identity = `gb:${(review.reviewerName ?? "anonimo").trim().toLowerCase()}`;
  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity,
    channel: "google_business",
    phone: null,
    waUserId: null,
    profileName: review.reviewerName,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id, {
    channel: "google_business",
    threadRef: review.name,
  });

  // Las reseñas se responden a mano: el reply es PÚBLICO y el agente nunca
  // debe publicar solo. Si quedó aiEnabled (default de la tabla), se apaga.
  if (conversation.aiEnabled) {
    await db
      .update(schema.conversation)
      .set({ aiEnabled: false, updatedAt: new Date() })
      .where(eq(schema.conversation.id, conversation.id));
    conversation.aiEnabled = false;
  }

  const messageId = `gbrev_${review.name.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: messageId,
      provider: "google_business",
      providerMessageId: review.name,
      direction: "in",
      type: "text",
      text: reviewMessageText(review),
      status: "delivered",
      waTimestamp: new Date(review.createTime),
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning({ id: schema.message.id });

  if (inserted[0]) {
    await db
      .update(schema.conversation)
      .set({
        lastInboundAt: new Date(review.createTime),
        lastMessageAt: new Date(review.createTime),
        unreadCount: (conversation.unreadCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversation.id, conversation.id));
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conversation.id } },
    });
  }

  return isNew;
}

/** Sync completa de una organización: locales + reseñas. Nunca lanza. */
export async function syncOrganization(organizationId: string): Promise<SyncResult | { error: string }> {
  const creds = await getGoogleBusinessCredentials(organizationId);
  if (!creds) return { error: "Sin credenciales de Google Business" };

  const token = await exchangeAccessToken(creds);
  if ("error" in token) {
    await markGoogleBusinessError(organizationId);
    await recordDiagnostic({
      organizationId,
      source: "google_business",
      severity: "error",
      code: "connection_failed",
      metadata: { detail: token.error },
    });
    return { error: token.error };
  }

  const accounts = await listAccounts(token);
  if ("error" in accounts) {
    await markGoogleBusinessError(organizationId);
    return { error: accounts.error };
  }

  let locationCount = 0;
  let reviewCount = 0;
  let newReviewCount = 0;

  for (const accountName of accounts.accounts) {
    const locations = await listLocations(token, accountName);
    if ("error" in locations) continue; // una cuenta falla, el resto sigue
    for (const loc of locations.locations) {
      const locationId = await upsertLocation(organizationId, loc);
      locationCount += 1;
      const reviews = await listReviews(token, loc.name);
      if ("error" in reviews) continue;
      for (const review of reviews.reviews) {
        reviewCount += 1;
        try {
          const created = await upsertReviewIntoInbox({ organizationId, locationId, review });
          if (created) newReviewCount += 1;
        } catch (err) {
          console.error("[google-business] reseña no ingerida:", review.name, err);
        }
      }
    }
  }

  await markGoogleBusinessSynced(organizationId);
  return { locations: locationCount, reviews: reviewCount, newReviews: newReviewCount };
}
