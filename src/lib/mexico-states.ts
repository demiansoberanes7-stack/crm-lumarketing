/**
 * Catálogo de entidades federativas de México + mapa de rejilla aproximado.
 * Compartido entre el servidor (DENUE, GT) y el cliente (paneles de mapa);
 * por eso vive en un archivo sin dependencias de BD ni fetch.
 */

export type MexicoState = {
  /** Clave INEGI que DENUE/Google Trends esperan. */
  code: string;
  name: string;
  short: string;
  /** Posición en el mapa de rejilla (aproximada, col/row 0-based). */
  col: number;
  row: number;
};

export const MEXICO_STATES: readonly MexicoState[] = [
  { code: "02", name: "Baja California", short: "BC", col: 0, row: 0 },
  { code: "26", name: "Sonora", short: "SON", col: 1, row: 0 },
  { code: "08", name: "Chihuahua", short: "CHH", col: 2, row: 0 },
  { code: "05", name: "Coahuila", short: "COAH", col: 3, row: 0 },
  { code: "19", name: "Nuevo León", short: "NL", col: 4, row: 0 },
  { code: "28", name: "Tamaulipas", short: "TAM", col: 5, row: 0 },
  { code: "03", name: "Baja California Sur", short: "BCS", col: 0, row: 1 },
  { code: "25", name: "Sinaloa", short: "SIN", col: 1, row: 1 },
  { code: "10", name: "Durango", short: "DUR", col: 2, row: 1 },
  { code: "32", name: "Zacatecas", short: "ZAC", col: 3, row: 1 },
  { code: "24", name: "San Luis Potosí", short: "SLP", col: 4, row: 1 },
  { code: "18", name: "Nayarit", short: "NAY", col: 1, row: 2 },
  { code: "14", name: "Jalisco", short: "JAL", col: 2, row: 2 },
  { code: "01", name: "Aguascalientes", short: "AGS", col: 3, row: 2 },
  { code: "11", name: "Guanajuato", short: "GTO", col: 4, row: 2 },
  { code: "22", name: "Querétaro", short: "QRO", col: 5, row: 2 },
  { code: "13", name: "Hidalgo", short: "HGO", col: 6, row: 2 },
  { code: "30", name: "Veracruz", short: "VER", col: 7, row: 2 },
  { code: "06", name: "Colima", short: "COL", col: 2, row: 3 },
  { code: "16", name: "Michoacán", short: "MICH", col: 3, row: 3 },
  { code: "15", name: "Estado de México", short: "MEX", col: 4, row: 3 },
  { code: "09", name: "Ciudad de México", short: "CDMX", col: 5, row: 3 },
  { code: "29", name: "Tlaxcala", short: "TLAX", col: 6, row: 3 },
  { code: "21", name: "Puebla", short: "PUE", col: 7, row: 3 },
  { code: "12", name: "Guerrero", short: "GRO", col: 3, row: 4 },
  { code: "17", name: "Morelos", short: "MOR", col: 4, row: 4 },
  { code: "20", name: "Oaxaca", short: "OAX", col: 6, row: 4 },
  { code: "23", name: "Quintana Roo", short: "QROO", col: 8, row: 4 },
  { code: "07", name: "Chiapas", short: "CHIS", col: 5, row: 5 },
  { code: "27", name: "Tabasco", short: "TAB", col: 6, row: 5 },
  { code: "04", name: "Campeche", short: "CAM", col: 7, row: 5 },
  { code: "31", name: "Yucatán", short: "YUC", col: 8, row: 5 },
] as const;
