import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { getBusinessSettings } from "@/server/business-settings";
import { AppShell } from "@/components/app-shell";
import { resolveBuildCommit } from "@/lib/version";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  // La marca (nombre/accento) y el logo subido viven en tablas distintas: se
  // piden juntas para que la barra lateral no haga un viaje por el logo.
  const [branding, business] = await Promise.all([
    getBranding(session.organizationId),
    getBusinessSettings(session.organizationId),
  ]);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      logoUrl={business.logoUrl || null}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      theme={theme}
      commit={resolveBuildCommit()}
    >
      {children}
    </AppShell>
  );
}
