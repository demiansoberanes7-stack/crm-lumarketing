import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// La versión sale de package.json y no de una constante aparte: duplicarla es
// tenerla desactualizada en uno de los dos lados, y justo esta no puede mentir.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // Paquetes que no deben empaquetarse en el bundle: nativos o que usan
  // APIs de Node que solo existen en runtime.
  serverExternalPackages: ["postgres", "nodemailer", "imapflow", "@resvg/resvg-js"],
  // @resvg/resvg-js elige su binario nativo con un require dinámico que el
  // trazado de archivos no puede resolver, así que el paquete de la plataforma
  // no llegaba al despliegue standalone y el logo SVG reventaba la ruta de PDF.
  // Declararlo aquí lo copia junto al resto del paquete.
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/@resvg/**/*"],
  },
  // Se congelan al construir: el binario lleva dentro de qué código salió, así
  // que no puede mentir en tiempo de ejecución. `SOURCE_COMMIT` lo inyecta
  // Coolify solo; con docker compose se pasa por `--build-arg` y si falta, la
  // app enseña solo la versión.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: process.env.SOURCE_COMMIT || process.env.GIT_SHA || "",
  },
  // Cabeceras de seguridad en todas las respuestas. No se declara CSP global:
  // Tailwind inyecta estilos en línea y una CSP mal calibrada rompería la UI en
  // producción. Lo que sí se acota sin riesgo es lo de abajo; el SVG que un
  // miembro sube como logo recibe su propio CSP+sandbox en la respuesta de media
  // (ver src/server/media-path.ts). El banner `X-Powered-By` no aporta nada a
  // un cliente y sí le dice a cualquiera qué stack mirar: fuera.
  poweredByHeader: false,
  async headers() {
    // El panel del chat del sitio es la única vista que se enmarca desde un
    // dominio que no es este: la web del cliente. Se saca del comodín en vez de
    // repetir la cabecera porque, con dos reglas que fijan la misma clave, quién
    // gana depende del orden interno del servidor y el widget se rompería en
    // silencio. Encuadrarlo no expone nada: el visitante no lleva sesión, se
    // identifica con la llave pública y su propio id, y el envío se valida en el
    // servidor contra los orígenes autorizados.
    return [
      {
        source: "/((?!embed/webchat).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // La única vista embebida es un <iframe> propio sobre un blob: de PDF,
          // que SAMEORIGIN no afecta; lo que corta es el clickjacking externo.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Sin cámara, micrófono ni geolocalización en la app: el audio se sube
          // como archivo y la ubicación llega de WhatsApp, no del navegador.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // 180 días, sin preload ni includeSubDomains: Caddy renueva el
          // certificado ACME solo, pero deja salida si algo volviera a servir
          // esta raíz por HTTP.
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
      {
        source: "/embed/webchat",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },
};

export default nextConfig;
