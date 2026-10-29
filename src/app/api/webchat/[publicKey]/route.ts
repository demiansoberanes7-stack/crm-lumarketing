import { findWebchatOrganization } from "@/server/webchat/settings";

export const dynamic = "force-dynamic";

/**
 * Configuración pública del widget: título y saludo.
 *
 * Es lo único que el script incrustado necesita saber antes de dibujar el
 * botón. Se devuelve con CORS abierto porque el navegador del visitante la lee
 * desde SU dominio, antes de que exista el iframe; no contiene nada que no se
 * vaya a ver en la propia página.
 */

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};

type Params = { params: Promise<{ publicKey: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { publicKey } = await params;
  const found = await findWebchatOrganization(publicKey);
  // Apagado o llave desconocida: el script retira el botón en vez de mostrar
  // un chat que no va a contestar.
  if (!found || !found.settings.enabled) {
    return Response.json(
      { enabled: false },
      { status: 404, headers: { ...CORS_HEADERS, "cache-control": "no-store" } }
    );
  }
  return Response.json(
    {
      enabled: true,
      title: found.settings.title,
      welcome: found.settings.welcome,
    },
    { headers: { ...CORS_HEADERS, "cache-control": "no-store" } }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
