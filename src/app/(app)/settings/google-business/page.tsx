import { notFound } from "next/navigation";
import { GoogleBusinessClient } from "@/components/settings/google-business-client";
import { googleBusinessEnabled } from "@/server/google-business/flag";

export const dynamic = "force-dynamic";

export default function GoogleBusinessSettingsPage() {
  if (!googleBusinessEnabled()) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <GoogleBusinessClient />
    </div>
  );
}
