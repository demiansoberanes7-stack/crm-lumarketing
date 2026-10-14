import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { intelEnabled } from "@/server/intel/flag";
import { IntelClient } from "@/components/inteligencia/intel-client";

export const dynamic = "force-dynamic";

/** Módulo de inteligencia de mercado (bandera INTEL). Visible para todos los roles. */
export default async function InteligenciaPage() {
  if (!intelEnabled()) notFound();
  await requireSession();
  return <IntelClient />;
}
