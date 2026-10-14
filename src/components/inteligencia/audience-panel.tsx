"use client";

import { Users } from "lucide-react";
import { ENDUTIH_2024 } from "@/lib/intel/demographics";

/**
 * Contexto de audiencia digital de México (ENDUTIH 2024). NO es audiencia
 * por nicho: la limitación se muestra junto al dato, obligatoria por
 * metodología (nunca presentar contexto demográfico como audiencia de nicho).
 */
export function AudiencePanel() {
  const d = ENDUTIH_2024;
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Contexto de audiencia digital (ENDUTIH)">
      <h2 className="flex items-center gap-2 font-semibold">
        <Users className="h-4 w-4 text-brand-text" /> Audiencia digital de México
        <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-text">
          contexto, no nicho
        </span>
      </h2>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">Penetración</dt>
          <dd className="text-lg font-semibold">{d.penetracionPct}%</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">Usuarios</dt>
          <dd className="text-lg font-semibold">{d.usuariosTotalesMillones} M</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">Horas/día</dt>
          <dd className="text-lg font-semibold">{d.horasPromedioDiarias}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold text-text-2">Uso de internet por edad (% 2024)</h3>
          <ul className="mt-2 space-y-1.5">
            {d.porEdad.map((row) => (
              <li key={row.label} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[11px] text-text-3">{row.label}</span>
                <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-subtle">
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm bg-brand-text/70"
                    style={{ width: `${row.pct}%` }}
                  />
                </span>
                <span className="w-11 shrink-0 text-right text-[11px] font-medium tabular-nums">{row.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-text-2">Por sexo (% usuarios 2024)</h3>
          <ul className="mt-2 space-y-2">
            {d.porSexo.map((row) => (
              <li key={row.label} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-text-3">{row.label}</span>
                <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-subtle">
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm bg-brand-text/70"
                    style={{ width: `${row.pct}%` }}
                  />
                </span>
                <span className="w-11 shrink-0 text-right text-[11px] font-medium tabular-nums">{row.pct}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-snug text-text-3">
            Horas promedio por edad: {d.porEdad.map((r) => `${r.label}h ${r.horas}`).join(" · ")}.
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-md bg-subtle p-3 text-[11px] leading-snug text-text-2">
        <span className="font-semibold">Limitación: </span>
        {d.limitacion} Fuente: {d.fuente} (publicado {d.fechaPublicacion}; encuesta {d.periodoEncuesta}, {d.muestra}).
      </p>
    </section>
  );
}
