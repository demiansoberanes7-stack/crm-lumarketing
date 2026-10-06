import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { MarketingClient } from "@/components/settings/marketing-client";

export const dynamic = "force-dynamic";

export default async function MarketingSettingsPage() {
  // Las credenciales de ads/analytics son territorio del dueño, igual que
  // Webhooks: la pestaña no aparece para otros roles y la URL directa 404.
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return <MarketingClient />;
}
