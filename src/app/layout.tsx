import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { BRAND_TAGLINE } from "@/lib/brand";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBrandingContextForRequest } from "@/server/branding";
import "./globals.css";

// Fuentes self-hosted (woff2 locales, sin CDN en runtime: soberanía).
// Geist y Geist Mono: la voz del chrome del starter (vercel/geist-font).
const geist = localFont({
  src: [{ path: "../fonts/Geist-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
});
const instrumentSerif = localFont({
  src: [
    { path: "../fonts/InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});
const geistMono = localFont({
  src: [{ path: "../fonts/GeistMono-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
});

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getBrandingContextForRequest().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;
  return {
    // Con `template`, cualquier página que ponga su título lo hace DESPUÉS de la
    // marca y no en vez de ella. Sin esto, una sección con `metadata.title`
    // propio borraba el nombre del negocio de la pestaña (y dos páginas lo
    // tenían escrito a mano con el nombre de otra empresa).
    title: {
      default: `${branding.name} — CRM de WhatsApp`,
      template: `%s — ${branding.name}`,
    },
    description: `${branding.name} — ${BRAND_TAGLINE}`,

    // El `?v=` cambia con la marca: los navegadores guardan el favicon con una
    // insistencia notable y, sin eso, el logo nuevo tarda días en aparecer.
    icons: { icon: faviconHref(branding, ctx?.organizationId) },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = (
    await getBrandingContextForRequest().catch(() => null)
  )?.branding ?? DEFAULT_BRANDING;
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  return (
    <html
      lang="es"
      className={`${geist.variable} ${instrumentSerif.variable} ${geistMono.variable}`}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
