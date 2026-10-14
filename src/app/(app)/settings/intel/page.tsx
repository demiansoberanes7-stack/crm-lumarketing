import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { IntelSettingsClient } from "@/components/settings/intel-client";
import { intelEnabled } from "@/server/intel/flag";

export const dynamic = "force-dynamic";

/** Credenciales del módulo de inteligencia (owner, patrón Google Business). */
export default async function IntelSettingsPage() {
  if (!intelEnabled()) notFound();
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <IntelSettingsClient />
    </div>
  );
}
