import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import {
  deleteGoogleCredentials,
  getBusinessGoogleCredentials,
  peekGoogleCredentials,
  setGoogleTasksSync,
} from "@/server/agenda/connectors/google-credentials";
import { syncPendingTasks } from "@/server/agenda/tasks-sync";

export const dynamic = "force-dynamic";

/**
 * 015 · B2 — El calendario Google PERSONAL de quien está en la sesión.
 *
 * Las citas del negocio se siguen agendando contra el calendario de la empresa
 * (`/api/settings/google`, que es solo del dueño). Esta ruta escribe
 * exclusivamente la fila `user_id = sesión`: el `userId` NUNCA viene del body,
 * así que un miembro no puede tocar el calendario de otro ni el del negocio.
 *
 * Las credenciales de la app OAuth (Client ID y Client Secret) son del negocio:
 * un proyecto de Google Cloud por instancia, no por persona. Lo personal es el
 * consentimiento —y por tanto el calendario—, no la app.
 *
 * Salida sin secretos: solo el estado y el `calendarId` de esa persona.
 */

function shape(
  creds: Awaited<ReturnType<typeof peekGoogleCredentials>>,
  businessConnected: boolean
) {
  return {
    // `calendarId` se muestra entero: no es un secreto, es el nombre del
    // calendario de esa persona, y es lo único que le sirve para reconocerlo.
    // Del secreto de la app NO se dice nada: es del negocio y a un miembro no le
    // compete ni su último dígito.
    connection: creds
      ? { status: creds.status, calendarId: creds.calendarId }
      : null,
    syncTasks: Boolean(creds?.syncTasks),
    businessConnected,
  };
}

export const GET = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const [own, business] = await Promise.all([
    // Sin cascada: esta tarjeta enseña el calendario PERSONAL, y decir «conectado
    // porque el del negocio sí lo está» sería mentirle a quien no conectó el suyo.
    peekGoogleCredentials(session.organizationId, session.userId),
    getBusinessGoogleCredentials(session.organizationId),
  ]);
  return Response.json(shape(own, Boolean(business)));
});

const syncSchema = z.object({ syncTasks: z.boolean() });

/**
 * Solo el interruptor de tareas. No hay PUT aquí a propósito: unas credenciales
 * personales no se escriben a mano, se obtienen autorizando en Google, y pegar
 * un refresh token ajeno en esta caja sería la forma más fácil de enredar dos
 * calendarios.
 */
export const PATCH = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, syncSchema);
  if (!body.ok) return body.response;

  const own = await peekGoogleCredentials(session.organizationId, session.userId);
  if (!own) {
    return apiError(409, "personal_not_connected", "Conecta tu calendario personal antes de sincronizar");
  }

  await setGoogleTasksSync(session.organizationId, body.data.syncTasks, session.userId);
  // Al encenderlo, las tareas que ya tenían fecha suben ahora — y SOLO las de
  // quien pulsa: las de sus compañeros pertenecen a otros calendarios y a otro
  // interruptor.
  const backfilled = body.data.syncTasks
    ? await syncPendingTasks(session.organizationId, 100, session.userId)
    : { synced: 0, failed: 0 };
  return Response.json({ syncTasks: body.data.syncTasks, backfilled });
});

/** Desconectar borra y revoca SOLO la fila de quien está en la sesión. */
export const DELETE = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  await deleteGoogleCredentials(session.organizationId, session.userId);
  return Response.json({ ok: true });
});
