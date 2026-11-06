import { notFound } from "next/navigation";
import { BookingsClient } from "@/components/bookings/bookings-client";
import { PageHeader } from "@/components/page-header";
import { agendaEnabled } from "@/server/agenda/flag";

export const dynamic = "force-dynamic";

export default function BookingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!agendaEnabled()) notFound();
  return (
    <div className="flex h-full flex-col">
      <PageHeader module="Operación · Citas" title="Citas" />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <BookingsClient />
      </div>
    </div>
  );
}
