"use client";

import { FunnelChart } from "./charts";
import { ChartCard } from "./chart-card";

interface Props {
  contacts: number;
  leads: number;
  quotes: number;
  approved: number;
  projects: number;
}

/**
 * Embudo de conversión comercial: Contactos → Leads → Cotizaciones →
 * Aprobadas → Proyectos completados. Usa el FunnelChart existente (CSS bars).
 */
export function LeadFunnelSection({ contacts, leads, quotes, approved, projects }: Props) {
  const stages = [
    { stage: "Contactos", value: contacts },
    { stage: "Leads", value: leads },
    { stage: "Cotizaciones", value: quotes },
    { stage: "Aprobadas", value: approved },
    { stage: "Clientes", value: projects },
  ];

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        Embudo de conversión
      </h2>
      <ChartCard title="De contacto a cliente">
        <FunnelChart data={stages} height={220} />
        {/* Tasas de conversión entre etapas */}
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {stages.slice(0, -1).map((s, i) => {
            const next = stages[i + 1];
            const rate = s.value > 0 && next ? Math.round((next.value / s.value) * 100) : 0;
            return (
              <div key={s.stage}>
                <p className="text-lg font-bold tabular-nums">{rate}%</p>
                <p className="text-[10px] text-muted-foreground">{s.stage} → {next?.stage}</p>
              </div>
            );
          })}
        </div>
      </ChartCard>
    </section>
  );
}
