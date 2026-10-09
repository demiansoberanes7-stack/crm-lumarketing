"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CampaignForm,
  MarketplaceOrderForm,
  ServiceCostForm,
} from "@/components/commercial/registration-forms";

export function CommercialRegistrationPage() {
  const router = useRouter();
  const returnToDashboard = () => router.push("/dashboard");

  return (
    <main className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Registros comerciales</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Captura presupuestos planeados, costos de prestación y órdenes de Marketplace.
            </p>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Volver al dashboard
          </Link>
        </header>

        <CampaignForm onSaved={returnToDashboard} />
        <ServiceCostForm onSaved={returnToDashboard} />
        <MarketplaceOrderForm onSaved={returnToDashboard} />
      </div>
    </main>
  );
}
