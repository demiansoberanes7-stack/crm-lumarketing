import { withOwner } from "@/lib/api";
import { getConnectionsStatus } from "@/server/connections/status";

export const dynamic = "force-dynamic";

/** Estado agregado de conexiones no-mensajería. Lógica en el servicio compartido. */
export const GET = withOwner(async (session) =>
  Response.json(await getConnectionsStatus(session.organizationId))
);
