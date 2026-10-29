import type { Metadata } from "next";
import { WEBCHAT_KEY_PATTERN } from "@/lib/webchat";
import { WebchatPanel } from "@/components/webchat/webchat-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat",
  robots: { index: false, follow: false },
};

/**
 * Lo que carga el iframe del widget. Vive en el mismo origen que la API del
 * chat, así que las peticiones del panel son del mismo sitio: sin CORS ni
 * cookies de terceros (que los navegadores bloquean cada vez más).
 *
 * La llave viene en `?key=`: si no tiene forma de llave se responde sin tocar
 * la base de datos.
 */
export default async function WebchatEmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const key = (await searchParams).key ?? "";
  if (!WEBCHAT_KEY_PATTERN.test(key)) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background px-6 text-center text-sm text-text-2">
        Este chat no está disponible.
      </div>
    );
  }
  return <WebchatPanel publicKey={key} />;
}
