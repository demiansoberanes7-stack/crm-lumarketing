"use client";

import {
  MEDIUM_LABELS,
  MEDIUM_VALUES,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
} from "@/lib/contact-medium";

/**
 * Desplegable de "¿cómo se contactó?" — el medio de la primera conversación.
 *
 * Dos pasos en un solo renglón: primero el medio y, solo si es una red social,
 * cuál. Sin capturar es una opción explícita: un contacto al que nadie le
 * preguntó cómo llegó no debe quedar marcado como "llamada".
 */
export function MediumPicker({
  idPrefix,
  medium,
  mediumDetail,
  onChange,
}: {
  idPrefix: string;
  medium: string;
  mediumDetail: string;
  onChange: (next: { medium: string; mediumDetail: string }) => void;
}) {
  const esRedSocial = medium === "red_social";
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={`${idPrefix}-medium`}>
        ¿Cómo se contactó?
      </label>
      <div className="flex gap-2">
        <select
          id={`${idPrefix}-medium`}
          value={medium}
          onChange={(e) => onChange({ medium: e.target.value, mediumDetail })}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">Sin capturar</option>
          {MEDIUM_VALUES.map((value) => (
            <option key={value} value={value}>
              {MEDIUM_LABELS[value]}
            </option>
          ))}
        </select>
        {esRedSocial && (
          <select
            aria-label="¿Qué red social?"
            value={mediumDetail}
            onChange={(e) => onChange({ medium, mediumDetail: e.target.value })}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="">¿Cuál?</option>
            {SOCIAL_NETWORKS.map((network) => (
              <option key={network} value={network}>
                {SOCIAL_LABELS[network]}
              </option>
            ))}
          </select>
        )}
      </div>
      {esRedSocial && !mediumDetail && (
        <p className="text-[11px] text-warning-text">
          Elige la red social para poder mostrarla en la ficha.
        </p>
      )}
    </div>
  );
}
