import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mediaHeaders, resolveMediaFile } from "@/server/media-path";

/**
 * El endpoint público `/api/media/public/[orgId]/[...path]` no pide sesión, así
 * que su única defensa es que la ruta pedida siga dentro de `MEDIA_DIR/{orgId}`.
 * Antes un segmento `..` (admisible por `[\w.-]`) bastaba para sacar
 * `/proc/self/environ` y con él todos los secretos del contenedor.
 */

let root: string;
const ORG = "org-zorro";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zorro-media-"));
  process.env.MEDIA_DIR = root;
  mkdirSync(join(root, ORG, "catalog"), { recursive: true });
  writeFileSync(join(root, ORG, "catalog", "abc123.png"), "png-falso");
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
