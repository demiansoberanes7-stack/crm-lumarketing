import { withAuth } from "@/lib/api";
import { CHANNEL_LABEL, isChannel, type Channel } from "@/lib/channels";
import { listConversations } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;

  // 053: el desplegable de envío de cotizaciones pide sólo un canal.
  const channelParam = url.searchParams.get("channel");
  if (channelParam !== null && !isChannel(channelParam)) {
    return Response.json(
      {
        error: {
          code: "invalid_channel",
          message: `Canal desconocido: ${channelParam}. Usa uno de ${Object.keys(CHANNEL_LABEL).join(", ")}`,
        },
      },
      { status: 400 }
    );
  }

  const conversations = await listConversations(
    session.organizationId,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    channelParam ? (channelParam as Channel) : undefined
  );
  return Response.json({ conversations });
});
