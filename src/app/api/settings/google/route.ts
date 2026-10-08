import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { googleConnector } from "@/server/agenda/connectors/google";
import {
  deleteGoogleCredentials,
  getGoogleCredentials,
  saveGoogleCredentials,
  secretLast4,
  setGoogleTasksSync,
} from "@/server/agenda/connectors/google-credentials";

export const dynamic = "force-dynamic";

/** 015 — Conexión de Google Calendar. Los secretos entran y no vuelven a salir. */

export const GET = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const creds = await getGoogleCredentials(session.organizationId);
  if (!creds) return Response.json({ connection: null, syncTasks: false });
  return Response.json({
    connection: {
      status: creds.status,
      secretLast4: secretLast4(creds.clientSecret),
      fields: { clientId: creds.clientId, calendarId: creds.calendarId },
    },
    syncTasks: creds.syncTasks,
  });
});

const credsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  refreshToken: z.string().trim().min(1),
  calendarId: z.string().trim().optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
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

  return Response.json({
    connection: {
      status: "connected",
      secretLast4: secretLast4(body.data.clientSecret),
      fields: { clientId: body.data.clientId, calendarId },
    },
  });
});

export const DELETE = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  await deleteGoogleCredentials(session.organizationId);
  return Response.json({ ok: true });
});

const syncSchema = z.object({ syncTasks: z.boolean() });

/**
 * Enciende o apaga la sincronización de Pendientes y tareas de proyecto.
 * Va aparte del PUT de credenciales: quien ya conectó no debe volver a pegar
 * secretos solo por mover un interruptor.
 */
export const PATCH = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, syncSchema);
  if (!body.ok) return body.response;
  const creds = await getGoogleCredentials(session.organizationId);
  if (!creds) return apiError(409, "google_not_connected", "Conecta Google antes de sincronizar tareas");
  await setGoogleTasksSync(session.organizationId, body.data.syncTasks);
  return Response.json({ syncTasks: body.data.syncTasks });
});
