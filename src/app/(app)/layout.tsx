import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionOrNull, getOrphanSession, getViewer } from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { getBusinessSettings } from "@/server/business-settings";
import { agendaEnabled } from "@/server/agenda/flag";
import { AppShell } from "@/components/app-shell";
import { resolveBuildCommit } from "@/lib/version";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) {
    // Hay sesión pero ningún negocio todavía (alta pública reciente, o cuenta de
    // cliente aún sin nombrar): mandarlo a /login lo dejaría en un bucle
    // /login → /inbox → /login porque el alta ya abrió sesión válida.
    redirect((await getOrphanSession()) ? "/crear-negocio" : "/login");
  }
  // La marca (nombre/accento) y el logo subido viven en tablas distintas: se
  // piden juntas para que la barra lateral no haga un viaje por el logo.
  const [branding, business] = await Promise.all([
    getBranding(session.organizationId),
    getBusinessSettings(session.organizationId),
  ]);
  const viewer = await getViewer();
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      logoUrl={business.logoUrl || null}
      userName={viewer?.name || "Usuario"}
      avatar={viewer?.image ?? null}
      role={session.role}
      theme={theme}
      commit={resolveBuildCommit()}
      agenda={agendaEnabled()}
    >
      {children}
    </AppShell>
  );
}
