import { notFound } from "next/navigation";
import { CopilotClient } from "@/components/settings/copilot-client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function CopilotSettingsPage() {
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return <CopilotClient />;
}
