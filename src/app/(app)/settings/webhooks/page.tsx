import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { WebhooksClient } from "@/components/settings/webhooks-client";

export const dynamic = "force-dynamic";

export default async function WebhooksSettingsPage() {
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return <WebhooksClient />;
}
