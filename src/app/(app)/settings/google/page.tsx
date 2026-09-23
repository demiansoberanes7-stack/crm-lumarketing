import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectorCredentials } from "@/components/settings/connector-credentials";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

export default function GoogleCalendarSettingsPage() {
  if (!agendaEnabled()) notFound();
  return (
    <div className="max-w-2xl space-y-5">
      <ConnectorCredentials connector="google" />
      <p className="text-sm text-text-2">
        Después de conectar, selecciona Google Calendar + Meet como conector en{" "}
        <Link href="/settings/calendar" className="text-brand-text underline">
          Agenda
        </Link>
        {" "}y guarda los ajustes para crear eventos y enlaces de Meet con tus citas.
      </p>
    </div>
  );
}
