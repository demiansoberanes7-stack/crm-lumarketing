import { notFound } from "next/navigation";
import { WebchatClient } from "@/components/settings/webchat-client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function WebchatSettingsPage() {
  const session = await requireSession();
  if (session.role !== "owner") notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <WebchatClient />
    </div>
  );
}
