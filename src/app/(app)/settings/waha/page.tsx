import { WahaClient } from "@/components/settings/waha-client";
import { WhatsappProvider } from "@/components/settings/whatsapp-provider";
export default function WahaSettingsPage() {
  return <div className="space-y-6"><WhatsappProvider /><WahaClient /></div>;
}
