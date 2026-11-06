import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getViewer } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // `getViewer` está memorizado por petición: el layout ya lo leyó y aquí no
  // cuesta una segunda consulta.
  const viewer = await getViewer();
  return <DashboardClient userName={viewer?.name || "Usuario"} />;
}
