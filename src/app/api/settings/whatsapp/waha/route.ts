import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getWahaCredentialsByOrg,
  saveWahaCredentials,
} from "@/server/waha/credentials";
import {
  getSessionStatus,
  startSession,
  stopSession,
  getQR,
  type WahaError,
} from "@/server/waha/client";

export const dynamic = "force-dynamic";

/** GET — estado de la conexión WAHA */
export const GET = withAuth(async (session) => {
  const creds = await getWahaCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });

  // Verificar estado real de la sesión en WAHA
  let sessionStatus = "UNKNOWN";
  let qr: string | null = null;
  try {
    const fullCreds = await import("@/server/waha/credentials").then((m) =>
      m.getWahaCredentialsFull(session.organizationId)
    );
    if (fullCreds) {
      const status = await getSessionStatus(
        fullCreds.baseUrl,
        fullCreds.apiKey,
        fullCreds.sessionName
      );
      sessionStatus = status.status;
      qr = status.qr ?? null;
    }
  } catch {
    sessionStatus = "UNKNOWN";
  }

  return Response.json({
    connection: {
      baseUrl: creds.baseUrl,
      sessionName: creds.sessionName,
      status: creds.status,
      sessionStatus,
      apiKeyLast4: creds.apiKeyLast4,
      qr,
    },
  });
});

const putSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  sessionName: z.string().min(1).default("default"),
});

/** PUT — guardar credenciales WAHA */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  // Verificar que la URL es accesible
  try {
    const status = await getSessionStatus(
      body.data.baseUrl,
      body.data.apiKey,
      body.data.sessionName ?? "default"
    );
    if (status.status === "FAILED") {
      return apiError(422, "waha_session_failed", "La sesión de WAHA falló al iniciar");
    }
  } catch (err) {
    const wahaErr = err as WahaError;
    return apiError(
      503,
      "waha_unreachable",
      `No se pudo conectar a WAHA: ${wahaErr.message}`
    );
  }

  await saveWahaCredentials({
    organizationId: session.organizationId,
    baseUrl: body.data.baseUrl,
    apiKey: body.data.apiKey,
    sessionName: body.data.sessionName,
  });

  return Response.json({ ok: true });
});

const actionSchema = z.object({
  action: z.enum(["start", "stop", "qr"]),
});

/** POST — acciones de sesión (start/stop/qr) */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, actionSchema);
  if (!body.ok) return body.response;

  const fullCreds = await import("@/server/waha/credentials").then((m) =>
    m.getWahaCredentialsFull(session.organizationId)
  );
  if (!fullCreds) {
    return apiError(404, "not_configured", "WAHA no está configurado");
  }

  try {
    if (body.data.action === "start") {
      await startSession(
        fullCreds.baseUrl,
        fullCreds.apiKey,
        fullCreds.sessionName
      );
      return Response.json({ ok: true, action: "started" });
    }

    if (body.data.action === "stop") {
      await stopSession(
        fullCreds.baseUrl,
        fullCreds.apiKey,
        fullCreds.sessionName
      );
      return Response.json({ ok: true, action: "stopped" });
    }

    if (body.data.action === "qr") {
      const qr = await getQR(
        fullCreds.baseUrl,
        fullCreds.apiKey,
        fullCreds.sessionName
      );
      return Response.json({ ok: true, qr });
    }
  } catch (err) {
    const wahaErr = err as WahaError;
    return apiError(500, "waha_error", wahaErr.message);
  }

  return apiError(400, "invalid_action", "Acción no válida");
});
