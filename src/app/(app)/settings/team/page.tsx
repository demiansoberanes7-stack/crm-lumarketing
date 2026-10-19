import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { TeamClient } from "@/components/settings/team-client";
import { ClientBusinessesCard } from "@/components/settings/client-businesses-card";
import { isInstanceOwner } from "@/server/auth/on-signup";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  // El alta de negocios lee todas las organizaciones, así que la tarjeta solo se
  // monta para quien opera la instancia; los demás owners ven su equipo.
  const canProvision =
    session.role === "owner" && (await isInstanceOwner(session.userId));

  return (
    <div className="space-y-6">
      {canProvision ? <ClientBusinessesCard /> : null}
      <TeamClient />
    </div>
  );
}
