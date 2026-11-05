import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectorCredentials } from "@/components/settings/connector-credentials";
import { GoogleOAuthBanner } from "@/components/settings/google-oauth-banner";
import { PersonalCalendar } from "@/components/settings/personal-calendar";
import { googleOAuthMessage } from "@/lib/agenda-oauth";
import { requireSession } from "@/lib/auth/session";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

/**
 * 015 · B2 — Google Calendar, en dos estados.
 *
 * La misma pantalla para dos calendarios que no son lo mismo:
 *
 *  · **El del negocio** (solo del dueño): con él se crean las citas que reservan
 *    los clientes y sus enlaces de Meet. Es la tarjeta de credenciales de siempre.
 *  · **El de cada persona** (todos los roles): sus Pendientes y sus tareas de
 *    proyecto con fecha. Es la tarjeta de abajo y no pide secretos —la app OAuth
 *    es la del negocio, lo personal es el consentimiento.
 *
 * El resultado de Google se pinta aquí y no dentro del componente de
 * credenciales por dos motivos: un miembro no renderiza ese componente y aun así
 * tiene que entender si su conexión funcionó, y porque hay fallos que se producen
 * antes de saber de qué calendario iban.
 */
export default async function GoogleCalendarSettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ connected?: string; error?: string; scope?: string }>;
}>) {
  if (!agendaEnabled()) notFound();
  const [session, params] = await Promise.all([requireSession(), searchParams]);
  const owner = session.role === "owner";
  const banner = googleOAuthMessage(params);

  return (
    <div className="max-w-2xl space-y-5">
      {banner && <GoogleOAuthBanner kind={banner.kind} text={banner.text} />}

      {owner ? (
        <>
          <ConnectorCredentials connector="google" />
          <p className="text-sm text-text-2">
            Después de conectar, selecciona Google Calendar + Meet como conector en{" "}
            <Link href="/settings/calendar" className="text-brand-text underline">
              Agenda
            </Link>
            {" "}y guarda los ajustes para crear eventos y enlaces de Meet con tus citas.
          </p>
        </>
      ) : (
        <p className="text-sm text-text-2">
          Las credenciales de Google de la empresa —y el calendario al que llegan
          las citas de los clientes— las administra quien tiene la cuenta. Aquí solo
          enlazas el tuyo, para tus tareas.
        </p>
      )}

      <PersonalCalendar />
    </div>
  );
}
