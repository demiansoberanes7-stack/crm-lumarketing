import { WahaClient } from "@/components/settings/waha-client";
import { WhatsappProvider } from "@/components/settings/whatsapp-provider";

export default function WahaSettingsPage() {
  return <div className="max-w-3xl space-y-5"><WhatsappProvider /><WahaClient /></div>;
}
