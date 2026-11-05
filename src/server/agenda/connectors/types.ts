import type { ConnectorId } from "@/lib/agenda-connectors";

/**
 * 015 — El contrato público de un conector de agenda.
 *
 * Deliberadamente pequeño: CUATRO operaciones, medidas del uso real en
 * producción de la integración de Zoom del fork de agencia — ni una más en
 * meses de operación. Ver specs/015-motor-agenda-universal/contracts/conector.md.
 *
 * Lo que NO está aquí y es a propósito: leer disponibilidad ajena (free/busy).
 * La disponibilidad se calcula 100% local, con una query y aritmética; meter al
 * proveedor en ese camino acoplaría su latencia y sus caídas a la pantalla que
 * más se usa. Los compromisos de fuera se reflejan con bloqueos manuales.
 *
 * Reglas que hace cumplir el MOTOR, no cada conector:
 *  1. Los efectos corren DESPUÉS de escribir la verdad en el CRM y son
 *     best-effort: una excepción de aquí jamás revierte ni bloquea la cita.
 *  2. Una cita de prueba del Laboratorio NUNCA llega hasta aquí — la aserción
 *     vive antes de la bifurcación por conector. Un conector no comprueba
 *     `is_test`: no le toca.
 */

export type MeetingRequest = {
  /** Motivo de la cita: su título propio o «Cita — <nombre del contacto>». */
  topic: string;
  /** Instante UTC ISO-8601 con Z. */
  startUtc: string;
  durationMinutes: number;
  /** Zona IANA del negocio: el proveedor la usa para mostrarla a los suyos. */
  timezone: string;
  notes?: string;
  /** Lugar/modalidad de la cita; solo los conectores con evento propio lo usan. */
  location?: string;
};

export type MeetingResult = {
  /** Id de la reunión/evento en el proveedor; null si no genera uno. */
  externalId: string | null;
  /** Lo que se le comparte al cliente; null si este conector no da link. */
  joinUrl: string | null;
};

export type TestConnectionResult =
  | { ok: true; detail?: string }
  | { ok: false; error: string };

/**
 * Lo que se manda al mover o editar una reunión ya creada.
 *
 * `summary`, `description` y `location` son opcionales y llegaron tarde a
 * propósito: existen porque la cita de Google ES un evento de calendario, y
 * desde el bloque A la cita tiene motivo propio, lugar y notas. Un conector que
 * solo gestiona la videoconferencia —Zoom— puede ignorarlos sin romper nada;
 * quien mantiene el evento de Google debe llevarlos, si no el calendario se
 * queda con «Cita — Ana» cuando el dueño renombró la cita.
 *
 * Regla del proveedor para quien SÍ los usa: un PATCH que no menciona
 * `conferenceData` NO toca el enlace de Meet. Borrarlo del evento sería dejar
 * sin reunión a un cliente ya avisado.
 */
export type UpdateMeetingRequest = Pick<
  MeetingRequest,
  "startUtc" | "durationMinutes" | "timezone"
> & {
  summary?: string;
  description?: string;
  location?: string;
};

export type AgendaConnector<Creds> = {
  id: ConnectorId;
  /** ¿Necesita credenciales guardadas para operar? */
  requiresCredentials: boolean;

  createMeeting(creds: Creds, req: MeetingRequest): Promise<MeetingResult>;

  updateMeeting(
    creds: Creds,
    externalId: string,
    req: UpdateMeetingRequest
  ): Promise<void>;

  /** Idempotente: un 404 del proveedor es éxito (ya no estaba). */
  deleteMeeting(creds: Creds, externalId: string): Promise<void>;

  testConnection(creds: Creds): Promise<TestConnectionResult>;

  /**
   * OPCIONAL: vuelve a leer una reunión ya creada.
   *
   * Existe por los proveedores que generan el enlace de forma asíncrona
   * (Google crea la conferencia en segundo plano y su respuesta inmediata
   * puede venir `pending`). Sin esto, "Reintentar enlace" sobre una cita que ya
   * tiene evento crearía un DUPLICADO en el calendario del dueño.
   *
   * Un conector cuyo enlace llega de inmediato —Zoom— no la necesita.
   */
  refreshMeeting?(creds: Creds, externalId: string): Promise<MeetingResult>;
};

/**
 * Error de un conector. `isAuthError` no es decorativo: cuando es true, el
 * motor marca la credencial como rota y la UI muestra la tarjeta de
 * reconexión. En el fork existe un helper igual que nadie consume y un estado
 * `error` que nunca se escribe — el aviso no llega y el dueño se entera por
 * el cliente que no recibió su link.
 */
export class ConnectorError extends Error {
  readonly connectorId: ConnectorId;
  readonly status: number | null;
  readonly isAuthError: boolean;

  constructor(
    connectorId: ConnectorId,
    message: string,
    opts?: { status?: number | null; isAuthError?: boolean }
  ) {
    super(message);
    this.name = "ConnectorError";
    this.connectorId = connectorId;
    this.status = opts?.status ?? null;
    // Criterio estricto: SOLO 401. El helper del fork trata cualquier 400 como
    // problema de credenciales, y un 400 de validación marcaría la conexión
    // como rota sin estarlo.
    this.isAuthError = opts?.isAuthError ?? opts?.status === 401;
  }
}
