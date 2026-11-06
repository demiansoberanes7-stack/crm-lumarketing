import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth/session";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  return (
    <div className="flex h-full flex-col">
      <PageHeader module="Sistema · Configuración" title="Configuración" />
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <SettingsNav owner={session.role === "owner"} agenda={agendaEnabled()} />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
