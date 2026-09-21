import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { WhatsappProvider } from "@/components/settings/whatsapp-provider";
import { WhatsappZernioClient } from "@/components/settings/whatsapp-zernio-client";
import { zernioWhatsappEnabled } from "@/server/whatsapp/zernio-credentials";

export const dynamic = "force-dynamic";

export default function WhatsappSettingsPage() {
  return <div className="max-w-4xl space-y-5"><WhatsappProvider />{zernioWhatsappEnabled() ? <><WhatsappZernioClient /><details><summary className="cursor-pointer py-2">Conexión Meta directa (avanzada)</summary><WhatsappWizard /></details></> : <WhatsappWizard />}</div>;
}
