import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isPublicMediaPath,
  mediaHeaders,
  publicMediaResponse,
  resolveMediaFile,
} from "@/server/media-path";

/**
 * El endpoint público `/api/media/public/[orgId]/[...path]` no pide sesión, así
 * que su única defensa es que la ruta pedida siga dentro de `MEDIA_DIR/{orgId}`.
 * Antes un segmento `..` (admisible por `[\w.-]`) bastaba para sacar
 * `/proc/self/environ` y con él todos los secretos del contenedor.
 */

let root: string;
const ORG = "org-zorro";
/** Id de un adjunto del buzón: vive en la misma raíz, pero NO es público. */
const ASSET = "masset_0123456789abcdefghij";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zorro-media-"));
  process.env.MEDIA_DIR = root;
  mkdirSync(join(root, ORG, "catalog"), { recursive: true });
  writeFileSync(join(root, ORG, "catalog", "abc123.png"), "png-falso");
  writeFileSync(join(root, ORG, "logo-zorro.png"), "logo-falso");
  writeFileSync(join(root, ORG, ASSET), "foto-del-cliente");
  // Archivo fuera del negocio, para comprobar que la traversal no lo alcanza.
  writeFileSync(join(root, "secreto.txt"), "no-debe-leerse");
});

describe("resolveMediaFile", () => {
  it("devuelve el archivo dentro del negocio", () => {
    const file = resolveMediaFile(ORG, "catalog", "abc123.png");
    expect(file).not.toBeNull();
    expect(readFileSync(file!)).toEqual(Buffer.from("png-falso"));
  });

  it("rinde una ruta válida aunque el archivo no exista (el llamador decide el 404)", () => {
    expect(resolveMediaFile(ORG, "catalog", "no-existe.png")).toBe(
      join(root, ORG, "catalog", "no-existe.png")
    );
  });

  it.each([
    ["..", "..", "secreto.txt"],
    ["catalog", "..", "..", "secreto.txt"],
    ["....", "secreto.txt"],
    ["..%2fetc", "passwd"],
  ])("rechaza la traversal con segmentos %j", (...segments) => {
    expect(resolveMediaFile(ORG, ...segments)).toBeNull();
  });

  it("rechaza un orgId que no sea un id opaco", () => {
    expect(resolveMediaFile("..", "secreto.txt")).toBeNull();
    expect(resolveMediaFile("org/zorro", "abc.png")).toBeNull();
    expect(resolveMediaFile("", "abc.png")).toBeNull();
  });

  it("rechaza un segmento vacío o absoluto", () => {
    expect(resolveMediaFile(ORG, "")).toBeNull();
    expect(resolveMediaFile(ORG, "/etc/passwd")).toBeNull();
  });

  it("un enlace simbólico que apunta fuera del negocio no se sirve", () => {
    const outside = join(root, "secreto.txt");
    const link = join(root, ORG, "escape.png");
    symlinkSync(outside, link);
    expect(resolveMediaFile(ORG, "escape.png")).toBeNull();
  });

  it("sin segmentos no hay ruta", () => {
    expect(resolveMediaFile(ORG)).toBeNull();
  });
});

describe("mediaHeaders", () => {
  it("acota los SVG (el logo admite SVG subido por un miembro)", () => {
    const headers = mediaHeaders("image/svg+xml");
    expect(headers["content-security-policy"]).toContain("sandbox");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  it("no añade CSP a un mapa de bits", () => {
    const headers = mediaHeaders("image/png");
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["content-type"]).toBe("image/png");
  });
});

/**
 * La lista de lo público.
 *
 * El fallo que cubre esto no era de rutas sino de alcance: el volumen de media
 * es plano por negocio, así que `catalog/foto.jpg` (pensada para verse sin
 * sesión) y `masset_…` (la foto que un cliente mandó al buzón) vivían en el
 * mismo árbol y la ruta pública servía ambos. Un id de asset no es una
 * contraseña: aparece en URLs de mensaje, en logs y en el payload que reenvían
 * algunos proveedores, así que `GET /api/media/public/{org}/{assetId}` sin
 * cookies devolvía la foto de un cliente a quien la pidiera.
 */
describe("isPublicMediaPath", () => {
  it("publica el catálogo y el logo", () => {
    expect(isPublicMediaPath(["catalog", "abc123.png"])).toBe(true);
    expect(isPublicMediaPath(["logo-zorro.png"])).toBe(true);
    expect(isPublicMediaPath(["logo-zorro.svg"])).toBe(true);
  });

  it.each([
    ["el adjunto del buzón", [ASSET]],
    ["un adjunto con extensión", [`${ASSET}.jpg`]],
    ["la raíz del negocio", ["catalog"]],
    ["un subdirectorio dentro del catálogo", ["catalog", "sub", "abc.png"]],
    ["el favicon generado", ["favicon"]],
    ["una carpeta que empieza igual", ["catalogo", "abc.png"]],
    ["un logo anidado", ["nested", "logo-zorro.png"]],
    ["nada", []],
  ])("NO publica %s", (_label, segments) => {
    expect(isPublicMediaPath(segments)).toBe(false);
  });

  it("una traversal con forma de catálogo tampoco pasa", () => {
    expect(isPublicMediaPath(["catalog", "..", "secreto.txt"])).toBe(false);
    expect(isPublicMediaPath(["catalog", "secreto.txt"])).toBe(true);
  });
});

describe("publicMediaResponse", () => {
  it("sirve una foto del catálogo con su tipo", async () => {
    const res = publicMediaResponse(ORG, ["catalog", "abc123.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("png-falso");
  });

  it("sirve el logo por las dos formas de URL que ya están en producción", async () => {
    // La ruta de un segmento es el alias histórico: así quedó guardada la URL
    // del logo en `organization.metadata`.
    const res = publicMediaResponse(ORG, ["logo-zorro.png"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("logo-falso");
  });

  it.each([
    ["el adjunto de un cliente", [ASSET]],
    ["el adjunto con extensión", [`${ASSET}.jpg`]],
    ["el favicon", ["favicon"]],
    ["una ruta con un segmento de más", ["catalog", "abc123.png", "extra"]],
  ])("responde 404 a %s sin confirmar que existe (%j)", async (_label, segments) => {
    const res = publicMediaResponse(ORG, segments);
    // 404 y no 403: esta ruta no tiene sesión, y un 403 diría gratis que el
    // archivo del cliente está ahí.
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("foto-del-cliente");
  });

  it("404 también cuando el archivo público no está", () => {
    expect(publicMediaResponse(ORG, ["catalog", "no-existe.png"]).status).toBe(404);
  });

  it("422 si el nombre pedido no puede ser una ruta", () => {
    // No es un asunto de permisos sino de entrada mal formada; se dice como es.
    expect(publicMediaResponse(ORG, ["catalog", "mal nombre.png"]).status).toBe(422);
    expect(publicMediaResponse("org/../evil", ["catalog", "abc123.png"]).status).toBe(422);
  });

  it("el SVG se sirve acotado, no ejecutable", () => {
    writeFileSync(join(root, ORG, "logo-zorro.svg"), "<svg/>");
    const res = publicMediaResponse(ORG, ["logo-zorro.svg"]);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("un catálogo ajeno al negocio no se alcanza", () => {
    mkdirSync(join(root, "org-otra", "catalog"), { recursive: true });
    writeFileSync(join(root, "org-otra", "catalog", "abc123.png"), "de-otro");
    expect(publicMediaResponse(ORG, ["catalog", "abc123.png"]).status).toBe(200);
    expect(publicMediaResponse("org-otra", ["catalog", "inexistente.png"]).status).toBe(404);
    expect(readFileSync(join(root, ORG, "catalog", "abc123.png"), "utf8")).toBe("png-falso");
  });
});

