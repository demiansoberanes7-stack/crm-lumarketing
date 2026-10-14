/**
 * Contexto de audiencia digital de México — ENDUTIH 2024 (INEGI).
 *
 * Datos oficiales publicados en mayo 2025 (encuesta jun–ago 2024, 65 067
 * viviendas). NO es la audiencia de un nicho específico: es el perfil de
 * QUIÉN usa internet en México. Cualquier panel que use estos números debe
 * mostrar esta limitación junto al dato (regla: nunca presentar contexto
 * demográfico como audiencia de nicho).
 *
 * Fuente: https://www.inegi.org.mx/programas/endutih/2024/
 */

export const ENDUTIH_2024 = {
  fuente: "ENDUTIH 2024 · INEGI",
  fechaPublicacion: "2025-05-06",
  periodoEncuesta: "jun–ago 2024",
  muestra: "65 067 viviendas",
  cobertura: "Población de 6 años y más (nacional)",
  usuariosTotalesMillones: 100.2,
  penetracionPct: 83.1,
  horasPromedioDiarias: 4.4,
  porSexo: [
    { label: "Hombres", pct: 84.1 },
    { label: "Mujeres", pct: 82.3 },
  ] as Array<{ label: string; pct: number }>,
  porEdad: [
    { label: "6 a 11", pct: 79.7, horas: 2.6 },
    { label: "12 a 17", pct: 95.1, horas: 4.5 },
    { label: "18 a 24", pct: 97.0, horas: 5.7 },
    { label: "25 a 34", pct: 95.1, horas: 5.6 },
    { label: "35 a 44", pct: 92.3, horas: 4.7 },
    { label: "45 a 54", pct: 83.8, horas: 3.9 },
    { label: "55 a 64", pct: 71.0, horas: 3.2 },
    { label: "65+", pct: 42.1, horas: 3.0 },
  ] as Array<{ label: string; pct: number; horas: number }>,
  limitacion:
    "Describe a la población usuaria de internet en México en general; NO es la composición por edad/sexo de un nicho ni de una campaña. Ninguna fuente gratuita ofrece edad/géreo por nicho.",
} as const;
