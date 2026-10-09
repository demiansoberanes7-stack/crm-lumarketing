import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { Ga4Error, ga4ConnectionState, parseGa4Credentials, readGa4Metrics, testGa4Connection } from "@/server/analytics/ga4";

/**
 * El cliente GA4 nació sin una sola prueba y el fallo pasó desapercibido:
 * el canjear mandaba `grant_type=jwt-bearer` y Google respondía
 * "Invalid grant_type: jwt-bearer", con lo que ni la prueba de conexión ni el
 * dashboard de marketing podían leer nada.
 *
 * Aquí se cubre el contrato con Google (el `grant_type` exacto), la traducción
 * de sus errores a algo accionable y que el token se cachea entre lecturas.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const TOKEN_URL = "https://oauth2.googleapis.com/token";

let seq = 0;
/** Cuenta distinta por prueba: el caché de tokens vive en el módulo. */
function serviceAccount(): string {
  seq += 1;
  return JSON.stringify({
    client_email: `sa-${seq}-${Date.now()}@demo.iam.gserviceaccount.com`,
    private_key: PEM,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const okReport = { rows: [{ metricValues: [{ value: "42" }] }] };

type FetchMock = ReturnType<typeof vi.fn>;

/**
 * `fetch` falso: el canje va a TOKEN_URL y todo lo demás a la Data API.
 * El reporte recibe el body para poder distinguir los tres reportes de
 * `readGa4Metrics`, que comparten URL y solo cambian en sus dimensiones.
 */
function stubFetch(
  token: () => Response,
  report: (url: string, init?: RequestInit) => Response = () => json(okReport)
): FetchMock {
  const mock = vi.fn(async (url: string, init?: RequestInit) =>
    url.startsWith(TOKEN_URL) ? token() : report(url, init)
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function dimensionsOf(init?: RequestInit): string[] {
  const body = JSON.parse(String(init?.body ?? "{}")) as { dimensions?: { name: string }[] };
  return (body.dimensions ?? []).map((d) => d.name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAccessToken (canjear JWT → token)", () => {
  it("manda el grant_type completo que exige Google", async () => {
    const fetchMock = stubFetch(() => json({ access_token: "tok-1", expires_in: 3600 }));

    const result = await testGa4Connection({
      propertyId: "556920206",
      serviceAccountJson: serviceAccount(),
    });
    expect(result.ok).toBe(true);

    const call = fetchMock.mock.calls[0]!;
    const body = (call[1] as { body: URLSearchParams }).body;
    expect(call[0]).toBe(TOKEN_URL);
    // El apócrifo "jwt-bearer" es exactamente lo que Google rechaza.
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body.get("assertion")?.split(".")).toHaveLength(3);
  });

  it("rechaza un JSON de service account incompleto antes de llamar a Google", async () => {
    const fetchMock = stubFetch(() => json({ access_token: "nunca" }));

    const result = await testGa4Connection({
      propertyId: "1",
      serviceAccountJson: JSON.stringify({ client_email: "x@y.z" }),
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok === false && result.message).toContain("private_key");
  });

  it("un JSON que no es JSON da un error claro, no una excepción", async () => {
    const result = await testGa4Connection({
      propertyId: "1",
      serviceAccountJson: "esto no es json",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("no es válido");
  });

  it("traduce el fallo de firma a la private_key, que es lo que hay que arreglar", async () => {
    stubFetch(() =>
      json(
        { error: "invalid_grant", error_description: "Invalid JWT: signature verification failed" },
        400
      )
    );

    const result = await testGa4Connection({
      propertyId: "1",
      serviceAccountJson: serviceAccount(),
    });

    expect(result.ok).toBe(false);
    const message = result.ok === false ? result.message : "";
    expect(message).toContain("private_key");
    expect(message).toContain("signature verification failed"); // el texto original se conserva
  });

  it("explica cuando Google no reconoce la service account", async () => {
    stubFetch(() => json({ error: "invalid_client" }, 401));

    const result = await testGa4Connection({
      propertyId: "1",
      serviceAccountJson: serviceAccount(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("service account");
  });

  it("el token se cachea: dos pruebas hacen UN solo canje", async () => {
    const fetchMock = stubFetch(() => json({ access_token: "tok-cached", expires_in: 3600 }));
    const creds = { propertyId: "9", serviceAccountJson: serviceAccount() };

    await testGa4Connection(creds);
    await testGa4Connection(creds);

    const canjes = fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith(TOKEN_URL)
    );
    expect(canjes).toHaveLength(1);
  });

  it("un Google que no contesta no deja la petición abierta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
      })
    );

    const result = await testGa4Connection({
      propertyId: "1",
      serviceAccountJson: serviceAccount(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/no respondió en \d+ s/);
  });
});

describe("runReport (Data API)", () => {
  it("un 403 dice que falta el rol de observador, no que las credenciales son malas", async () => {
    stubFetch(
      () => json({ access_token: "tok-permiso", expires_in: 3600 }),
      () => json({ error: { message: "The caller does not have permission" } }, 403)
    );

    const result = await testGa4Connection({
      propertyId: "556920206",
      serviceAccountJson: serviceAccount(),
    });

    expect(result.ok).toBe(false);
    const message = result.ok === false ? result.message : "";
    expect(message).toContain("Observador de datos");
    expect(message).toContain("556920206");
  });

  it("una propiedad accesible devuelve el mensaje de conexión con sus sesiones", async () => {
    stubFetch(
      () => json({ access_token: "tok-ok", expires_in: 3600 }),
      () => json({ rows: [{ metricValues: [{ value: "17" }] }] })
    );

    const result = await testGa4Connection({
      propertyId: "556920206",
      serviceAccountJson: serviceAccount(),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toContain(
      "Conectado a la propiedad 556920206: 17 sesiones"
    );
  });
});

describe("readGa4Metrics", () => {
  it("normaliza totales, canales y serie diaria", async () => {
    stubFetch(
      () => json({ access_token: "tok-metrics", expires_in: 3600 }),
      (_url, init) => {
        const dims = dimensionsOf(init);
        if (dims.includes("sessionDefaultChannelGroup")) {
          return json({
            rows: [
              {
                dimensionValues: [{ value: "Organic Search" }],
                metricValues: [{ value: "10" }],
              },
            ],
          });
        }
        if (dims.includes("date")) {
          return json({
            rows: [
              { dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "3" }] },
            ],
          });
        }
        return json({
          rows: [
            { metricValues: [{ value: "30" }, { value: "12" }, { value: "4" }, { value: "0.25" }] },
          ],
        });
      }
    );

    const metrics = await readGa4Metrics({
      propertyId: "556920206",
      serviceAccountJson: serviceAccount(),
    });

    expect(metrics).toMatchObject({
      sessions: 30,
      users: 12,
      newUsers: 4,
      bounceRate: 0.25,
      sources: [{ name: "Organic Search", sessions: 10 }],
      daily: [{ date: "20261001", sessions: 3 }],
    });
  });
});

describe("parseGa4Credentials", () => {
  it("acepta el campo serviceAccountKey heredado y exige ambos datos", () => {
    expect(parseGa4Credentials({ propertyId: "123", serviceAccountJson: "{}" })).toEqual({
      propertyId: "123",
      serviceAccountJson: "{}",
    });
    expect(parseGa4Credentials({ propertyId: "123", serviceAccountKey: "{}" })).toEqual({
      propertyId: "123",
      serviceAccountJson: "{}",
    });
    expect(parseGa4Credentials({ propertyId: "", serviceAccountJson: "{}" })).toBeNull();
    expect(parseGa4Credentials({ propertyId: "123" })).toBeNull();
  });

  it("el error del cliente sigue siendo un Ga4Error", () => {
    expect(new Ga4Error("x")).toBeInstanceOf(Error);
    expect(new Ga4Error("x").name).toBe("Ga4Error");
  });
});

/**
 * El Marketing Hub pintaba "Desconectado" con un Property ID ya guardado:
 * decía que no había nada cuando faltaba UNA pieza, y el usuario terminaba
 * reconfigurando desde cero algo que sí estaba a medias.
 */
describe("ga4ConnectionState", () => {
  it("sin nada guardado sigue desconectado", () => {
    expect(ga4ConnectionState({})).toEqual({ status: "disconnected" });
    expect(ga4ConnectionState({ serviceAccountJson: "{}" })).toEqual({ status: "disconnected" });
  });

  it("Property ID sin service account dice exactamente qué falta", () => {
    const state = ga4ConnectionState({ propertyId: "556920206" });
    expect(state.status).toBe("configured");
    expect(state.message).toMatch(/service account/i);
    expect(state.message).toMatch(/Marketing/);
  });

  it("con las dos piezas queda configurado y sin aviso", () => {
    expect(ga4ConnectionState({ propertyId: "556920206", serviceAccountJson: "{}" }))
      .toEqual({ status: "configured" });
    expect(ga4ConnectionState({ propertyId: "556920206", serviceAccountKey: "{}" }))
      .toEqual({ status: "configured" });
  });
});
