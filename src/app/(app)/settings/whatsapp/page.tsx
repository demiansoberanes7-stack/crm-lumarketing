import { WhatsappZernioClient } from "@/components/settings/whatsapp-zernio-client";
import { zernioWhatsappEnabled } from "@/server/whatsapp/zernio-credentials";

export const dynamic = "force-dynamic";

export default function WhatsappSettingsPage() {
  if (!zernioWhatsappEnabled()) {
    return (
      <div className="max-w-4xl space-y-4 rounded-lg border p-5">
        <h3 className="text-xl font-semibold">WhatsApp mediante Zernio</h3>
        <p className="text-sm text-text-2">
          Conecta tu número en Zernio. Aquí podrás guardar el Account ID,
          la API key y el secreto de firma del webhook.
        </p>
        <p role="status" className="text-sm text-text-2">
          Para habilitar la conexión, configura <code>WHATSAPP_ZERNIO_ENABLED=true</code>
          {" "}en el servidor y reinicia la aplicación.
        </p>
      </div>
    );
  }
  return <div className="max-w-4xl space-y-5"><WhatsappZernioClient /></div>;
}
