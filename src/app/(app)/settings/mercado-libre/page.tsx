import { notFound } from "next/navigation";
import { MercadoLibreClient } from "@/components/settings/mercado-libre-client";
import { isChannelEnabled } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

export default function MercadoLibreSettingsPage() {
  if (!isChannelEnabled("mercado_libre")) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <MercadoLibreClient />
    </div>
  );
}
