import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { WhatsappProvider } from "@/components/settings/whatsapp-provider";

export const dynamic = "force-dynamic";

export default function WhatsappSettingsPage() {
  return <div className="space-y-6"><WhatsappProvider /><WhatsappWizard /></div>;
}
