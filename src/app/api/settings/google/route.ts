import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { googleConnector } from "@/server/agenda/connectors/google";
import {
  deleteGoogleCredentials,
  getBusinessGoogleCredentials,
  saveGoogleCredentials,
  secretLast4,
  setGoogleTasksSync,
} from "@/server/agenda/connectors/google-credentials";
import { googleOAuthRedirectUri } from "@/server/agenda/google-oauth";
import { syncPendingBookings } from "@/server/agenda/bookings-sync";
import { syncPendingTasks } from "@/server/agenda/tasks-sync";

export const dynamic = "force-dynamic";

/**
 * 015 — La conexión de Google Calendar DEL NEGOCIO.
 *
 * Esta pantalla es siempre `user_id IS NULL`: el calendario contra el que
 * reservan los clientes y con el que los conectores crean los enlaces de Meet.
 * El calendario personal de cada miembro vive en `/api/settings/google/personal`
 * y jamás se escribe desde aquí —por eso ninguna ruta de esta ficha acepta un
 * `userId` venido del body.
 *
 * Los secretos entran y no vuelven a salir.
 */

export const GET = withOwner(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const creds = await getBusinessGoogleCredentials(session.organizationId);
  if (!creds)
    return Response.json({
      connection: null,
      syncTasks: false,
      redirectUri: googleOAuthRedirectUri(),
    });
  return Response.json({
    connection: {
      status: creds.status,
      secretLast4: secretLast4(creds.clientSecret),
      fields: { clientId: creds.clientId, calendarId: creds.calendarId },
    },
    syncTasks: creds.syncTasks,
    redirectUri: googleOAuthRedirectUri(),
  });
});

const credsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  refreshToken: z.string().trim().min(1),
  calendarId: z.string().trim().optional(),
});

export const PUT = withOwner(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  const calendarId = body.data.calendarId?.trim() || "primary";
  const check = await googleConnector.testConnection({
    ...body.data,
    calendarId,
    status: "connected",
  });
  if (!check.ok) return apiError(422, "google_invalid", check.error);

  await saveGoogleCredentials({
    organizationId: session.organizationId,
    ...body.data,
    calendarId,
  });

  // Credenciales nuevas con el interruptor ya encendido: las tareas que
  // quedaron sin evento durante el corte se crean ahora. Las citas van detrás
  // por el mismo motivo —quien pega el token a mano espera ver SU agenda, no
  // solo las tareas— y con la misma regla: un fallo de Google no puede devolver
  // 500 de una operación que ya se guardó.
  const backfilled = await syncPendingTasks(session.organizationId);
  const bookings = await syncPendingBookings(session.organizationId).catch(() => ({
    synced: 0,
    failed: 0,
  }));

  return Response.json({
    connection: {
      status: "connected",
      secretLast4: secretLast4(body.data.clientSecret),
      fields: { clientId: body.data.clientId, calendarId },
    },
    backfilled,
    bookings,
  });
});

/** Desconectar el negocio revoca SU token en Google; no toca los personales. */
export const DELETE = withOwner(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  await deleteGoogleCredentials(session.organizationId, null);
  return Response.json({ ok: true });
});

const syncSchema = z.object({ syncTasks: z.boolean() });

/**
 * Enciende o apaga la sincronización de Pendientes y tareas de proyecto.
 * Va aparte del PUT de credenciales: quien ya conectó no debe volver a pegar
 * secretos solo por mover un interruptor.
 */
export const PATCH = withOwner(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, syncSchema);
  if (!body.ok) return body.response;
  const creds = await getBusinessGoogleCredentials(session.organizationId);
  if (!creds) return apiError(409, "google_not_connected", "Conecta Google antes de sincronizar tareas");
  await setGoogleTasksSync(session.organizationId, body.data.syncTasks, null);
  // Al encenderlo, las tareas que ya tenían fecha se suben de inmediato; si no,
  // el dueño tendría que editarlas una por una para que aparecieran.
  const backfilled = body.data.syncTasks
    ? await syncPendingTasks(session.organizationId)
    : { synced: 0, failed: 0 };
  return Response.json({ syncTasks: body.data.syncTasks, backfilled });
});
