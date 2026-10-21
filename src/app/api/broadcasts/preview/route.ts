import { apiError, parseBody, withAuth } from "@/lib/api";
import { previewBroadcastSchema } from "@/server/broadcasts/filters";
import { resolveBroadcastAudience } from "@/server/broadcasts/audience";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, previewBroadcastSchema);
  if (!body.ok) return body.response;

  const { channel, templateName, ...filters } = body.data;
  try {
    const recipients = await resolveBroadcastAudience(session.organizationId, filters, channel, {
      hasTemplate: Boolean(templateName),
    });
    const queued = recipients.filter((recipient) => recipient.status === "queued").length;
    const waiting = recipients.filter((recipient) => recipient.status === "waiting_window").length;
    const skippedByReason = recipients.reduce<Record<string, number>>((counts, recipient) => {
      if (recipient.status === "skipped" && recipient.skipReason) {
        counts[recipient.skipReason] = (counts[recipient.skipReason] ?? 0) + 1;
      }
      return counts;
    }, {});
    return Response.json({
      total: recipients.length,
      queued,
      waiting,
      skipped: recipients.length - queued - waiting,
      skippedByReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo calcular el segmento";
    return apiError(422, "broadcast_audience", message);
  }
});
