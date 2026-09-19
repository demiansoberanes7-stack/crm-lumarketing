import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { wahaWebhookUrl } from "@/server/waha/webhook-token";
import { getWahaCredentialsByOrg, getWahaCredentialsFull, saveWahaCredentials, markWahaReconnectRequired } from "@/server/waha/credentials";
import { getQR, WahaError, wahaRequest } from "@/server/waha/client";
import { inspectSession, reconcileSession } from "@/server/waha/session";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { validateWahaUrl } from "@/server/waha/url";

export const dynamic = "force-dynamic";
export const GET = withOwner(async (session) => {
  const creds = await getWahaCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  const full = await getWahaCredentialsFull(session.organizationId);
  let state = "UNKNOWN";
  let error: string | null = null;
  let account: string | null = null;
  let restrictions: unknown = null;
  try {
    const live = await inspectSession(full!);
    state = live.status;
    account = live.me?.id ?? null;
    restrictions = { reachoutTimelock: live.me?.reachoutTimelock, messageCapping: live.me?.messageCapping };
  } catch (err) { error = err instanceof WahaError ? err.message : "No se pudo consultar WAHA"; }
  return Response.json({ connection: { ...creds, sessionStatus: state, error, account, restrictions, webhookUrl: wahaWebhookUrl(session.organizationId) } });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ baseUrl: z.string().url(), apiKey: z.string().trim().optional(), sessionName: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,100}$/).default("default") }));
  if (!body.ok) return body.response;
  try {
    await validateWahaUrl(body.data.baseUrl);
    const previous = await getWahaCredentialsFull(session.organizationId);
    const apiKey = body.data.apiKey || (previous?.baseUrl === body.data.baseUrl ? previous.apiKey : "");
    if (!apiKey) return apiError(422, "missing_key", "Introduce la API key de este servidor WAHA");
    const creds = { baseUrl: body.data.baseUrl, apiKey, sessionName: body.data.sessionName ?? "default" };
    try { await inspectSession(creds); }
    catch (err) {
      if (!(err instanceof WahaError) || err.status !== 404) throw err;
      // Verify that a 404 really comes from an authenticated WAHA server.
      const sessions = await wahaRequest(creds.baseUrl, apiKey, "/api/sessions?all=true");
      if (!Array.isArray(sessions)) throw new WahaError("La URL no devolvió una API WAHA válida");
    }
    await saveWahaCredentials({ organizationId: session.organizationId, ...creds });
    await recordDiagnostic({ organizationId: session.organizationId, source: "waha", code: "connection_saved", severity: "info" });
    return Response.json({ ok: true });
  } catch (err) {
    await recordDiagnostic({ organizationId: session.organizationId, source: "waha", code: "connection_failed", error: err });
    return apiError(422, "waha_connection_failed", err instanceof WahaError ? err.message : "Revisa la URL HTTPS de WAHA, el host autorizado y la API key");
  }
});

export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ action: z.enum(["test", "start", "stop", "restart", "logout", "qr", "webhook"]) }));
  if (!body.ok) return body.response;
  const creds = await getWahaCredentialsFull(session.organizationId);
  if (!creds) return apiError(404, "not_configured", "Guarda primero la conexión WAHA");
  try {
    const { action } = body.data;
    if (action === "qr") {
      const qr = await getQR(creds.baseUrl, creds.apiKey, creds.sessionName);
      if (!qr) return apiError(409, "qr_unavailable", "El QR no está disponible. Comprueba que la sesión esté en SCAN_QR_CODE.");
      return Response.json({ ok: true, qr });
    }
    if (action === "start" || action === "webhook") await reconcileSession(session.organizationId, creds);
    if (["start", "stop", "restart", "logout"].includes(action)) await wahaRequest(creds.baseUrl, creds.apiKey, `/api/sessions/${encodeURIComponent(creds.sessionName)}/${action}`, { method: "POST" });
    const live = await inspectSession(creds);
    await recordDiagnostic({ organizationId: session.organizationId, source: "waha", code: "session_action", severity: "info", metadata: { operation: action, state: live.status } });
    return Response.json({ ok: true, sessionStatus: live.status });
  } catch (err) {
    if (err instanceof WahaError && (err.status === 401 || err.status === 403)) await markWahaReconnectRequired(session.organizationId);
    await recordDiagnostic({ organizationId: session.organizationId, source: "waha", code: "connection_failed", error: err });
    return apiError(503, "waha_error", err instanceof WahaError ? err.message : "No se pudo completar la acción WAHA");
  }
});

export const DELETE = withOwner(async (session) => {
  await getDb().delete(schema.wahaCredentials).where(scoped(schema.wahaCredentials.organizationId, session.organizationId));
  await recordDiagnostic({ organizationId: session.organizationId, source: "waha", code: "disconnected", severity: "info" });
  return Response.json({ ok: true });
});
