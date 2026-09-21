import { BusinessSettingsClient } from "@/components/settings/business-client";

export const dynamic = "force-dynamic";

export default function BusinessSettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <BusinessSettingsClient />
    </div>
  );
}
