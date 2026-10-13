import { apiError, parseBody, withAuth } from "@/lib/api";
import { previewBroadcastSchema } from "@/server/broadcasts/filters";
import { resolveBroadcastAudience } from "@/server/broadcasts/audience";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, previewBroadcastSchema);
  if (!body.ok) return body.response;

  const { channel, ...filters } = body.data;
  try {
    const recipients = await resolveBroadcastAudience(session.organizationId, filters, channel);
    const queued = recipients.filter((recipient) => recipient.status === "queued").length;
    const skippedByReason = recipients.reduce<Record<string, number>>((counts, recipient) => {
      if (recipient.skipReason) counts[recipient.skipReason] = (counts[recipient.skipReason] ?? 0) + 1;
      return counts;
    }, {});
    return Response.json({ total: recipients.length, queued, skipped: recipients.length - queued, skippedByReason });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo calcular el segmento";
    return apiError(422, "broadcast_audience", message);
  }
});
