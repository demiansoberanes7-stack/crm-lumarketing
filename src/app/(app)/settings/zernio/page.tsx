import { WhatsappZernioClient } from "@/components/settings/whatsapp-zernio-client";
import { zernioWhatsappEnabled } from "@/server/whatsapp/zernio-credentials";

export const dynamic = "force-dynamic";

export default function ZernioSettingsPage() {
  if (!zernioWhatsappEnabled()) {
    return (
      <div className="max-w-4xl space-y-5">
        <p className="text-text-2">
          WhatsApp Zernio no está habilitado en esta instancia. Activa la variable
          de entorno <code>WHATSAPP_ZERNIO_ENABLED=true</code> y reinicia el
          servidor.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl space-y-5">
      <WhatsappZernioClient />
    </div>
  );
}
