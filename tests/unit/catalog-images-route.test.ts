import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las fotos del catálogo, de la ruta hacia fuera.
 *
 * Lo que se fija aquí es lo que un cliente puede romper o intentar torcer:
 *
 *  1. El negocio NUNCA viene del cuerpo ni de la URL: lo pone la sesión. Un
 *     `organizationId` enviado a mano sería la forma más corta de escribir en
 *     el catálogo de otro.
 *  2. `POST` sin `multipart/form-data` no se intenta ni parsear.
 *  3. El rechazo del servicio (archivo que no es foto, tope lleno, producto
 *     ajeno) sale con su código y sin convertirse en un 500 mudo.
 *  4. `PATCH` con un cuerpo inútil no finge que actualizó algo.
 *  5. Borrar una foto de otro negocio ⇒ 404, no «ok».
 */

const mocks = vi.hoisted(() => {
  /** La clase real la define Better Auth; aquí basta con que sea la misma. */
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireSession: vi.fn(),
    addProductImage: vi.fn(),
    listProductImages: vi.fn(),
    setPrimaryProductImage: vi.fn(),
    reorderProductImages: vi.fn(),
    deleteProductImage: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  UnauthorizedError: mocks.UnauthorizedError,
}));
vi.mock("@/server/catalog/images", () => ({
  addProductImage: mocks.addProductImage,
  listProductImages: mocks.listProductImages,
  setPrimaryProductImage: mocks.setPrimaryProductImage,
  reorderProductImages: mocks.reorderProductImages,
  deleteProductImage: mocks.deleteProductImage,
}));

import { GET, PATCH, POST } from "@/app/api/catalog/[id]/images/route";
import { DELETE } from "@/app/api/catalog/images/[imageId]/route";

const PRODUCT = "cat_1";

/** Cabecera PNG real: firma + IHDR con 4x4. `pngBytes` es lo que ve el servicio. */
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0,
  0, 4, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/** El contexto de Next (`{ params }`) como lo recibe la ruta envuelta. */
const ctx = (params: { id: string } | { imageId: string }) =>
  ({ params: Promise.resolve(params) }) as never;

/** GET y DELETE van envueltos con el Request delante, aunque no lo lean. */
const bare = () => new Request("http://local/api/catalog/pimg_1");

function useSession(organizationId = "org_zorro") {
  mocks.requireSession.mockResolvedValue({ userId: "user_1", organizationId, role: "owner" });
}

const json = (method: string, body: unknown) =>
  new Request(`http://local/api/catalog/${PRODUCT}/images`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Las API de la casa devuelven `{ error: { code, message } }`, no un plano. */
const errOf = (body: unknown) => (body as { error: { code: string; message: string } }).error;

function upload(file: File | null, altText?: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  if (altText !== undefined) form.append("altText", altText);
  return new Request(`http://local/api/catalog/${PRODUCT}/images`, { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSession();
});

describe("GET /api/catalog/[id]/images", () => {
  it("lista la tira con el negocio de la sesión", async () => {
    mocks.listProductImages.mockResolvedValue([{ id: "pimg_1" }]);
    const res = await GET(bare(), ctx({ id: PRODUCT }));
    expect(await res.json()).toEqual({ images: [{ id: "pimg_1" }] });
    expect(mocks.listProductImages).toHaveBeenCalledWith("org_zorro", PRODUCT);
  });
});

describe("POST /api/catalog/[id]/images", () => {
  it("sube la foto y pasa el negocio de la sesión, no del cuerpo", async () => {
    mocks.addProductImage.mockResolvedValue({ ok: true, image: { id: "pimg_1" } });
    const res = await POST(upload(new File([pngBytes], "foto.png", { type: "image/png" })), ctx({ id: PRODUCT }));
    expect(res.status).toBe(201);
    const arg = mocks.addProductImage.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({ organizationId: "org_zorro", productId: PRODUCT, userId: "user_1" });
    // El nombre lo escribe quien sube; lo que se manda al servicio son los bytes.
    expect(arg.bytes).toEqual(pngBytes);
  });

  it("normaliza el texto alternativo antes de llegar al servicio", async () => {
    mocks.addProductImage.mockResolvedValue({ ok: true, image: { id: "pimg_1" } });
    await POST(upload(new File([pngBytes], "a.png"), "  silla   de madera  "), ctx({ id: PRODUCT }));
    expect((mocks.addProductImage.mock.calls[0]![0] as { altText: string }).altText).toBe(
      "silla de madera"
    );
  });

  it("rechaza un JSON enviado al endpoint de subida", async () => {
    const res = await POST(
      json("POST", { organizationId: "org_ajena", productId: "cat_otro" }),
      ctx({ id: PRODUCT })
    );
    expect(res.status).toBe(422);
    expect(mocks.addProductImage).not.toHaveBeenCalled();
  });

  it("avisa cuando el multipart llega roto, en vez de dejar un 500", async () => {
    const res = await POST(
      {
        headers: new Headers({ "content-type": "multipart/form-data; boundary=x" }),
        formData: () => Promise.reject(new Error("cuerpo cortado")),
      } as unknown as Request,
      ctx({ id: PRODUCT })
    );
    expect(res.status).toBe(422);
    expect(errOf(await res.json()).message).toContain("No se pudo leer");
  });

  it("un campo que no es archivo no es una subida", async () => {
    const form = new FormData();
    form.append("file", "no-es-archivo");
    const res = await POST(
      new Request(`http://local/api/catalog/${PRODUCT}/images`, { method: "POST", body: form }),
      ctx({ id: PRODUCT })
    );
    expect(res.status).toBe(422);
    expect(errOf(await res.json()).code).toBe("missing_file");
  });

  it("el producto de otro negocio sale 404", async () => {
    mocks.addProductImage.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "Producto no encontrado",
    });
    const res = await POST(upload(new File([pngBytes], "a.png")), ctx({ id: PRODUCT }));
    expect(res.status).toBe(404);
  });

  it("lo que no es una foto se rechaza con el motivo", async () => {
    mocks.addProductImage.mockResolvedValue({
      ok: false,
      code: "invalid_image",
      message: "Solo se aceptan JPG, PNG, WEBP o GIF.",
    });
    const res = await POST(
      upload(new File([new TextEncoder().encode("<html/>")], "nota.png", { type: "image/png" })),
      ctx({ id: PRODUCT })
    );
    expect(res.status).toBe(422);
    expect(errOf(await res.json()).code).toBe("invalid_image");
  });
});

describe("PATCH /api/catalog/[id]/images", () => {
  it("un cuerpo vacío no finge una actualización", async () => {
    const res = await PATCH(json("PATCH", {}), ctx({ id: PRODUCT }));
    expect(res.status).toBe(422);
  });

  it("una principal vacía tampoco: 422 en vez de 200 sin hacer nada", async () => {
    const res = await PATCH(json("PATCH", { primaryId: "" }), ctx({ id: PRODUCT }));
    expect(res.status).toBe(422);
    expect(mocks.setPrimaryProductImage).not.toHaveBeenCalled();
  });

  it("reordena y marca principal, siempre del negocio de la sesión", async () => {
    mocks.setPrimaryProductImage.mockResolvedValue({ ok: true });
    mocks.listProductImages.mockResolvedValue([]);
    const res = await PATCH(
      json("PATCH", { orderedIds: ["pimg_b", "pimg_a"], primaryId: "pimg_a" }),
      ctx({ id: PRODUCT })
    );
    expect(res.status).toBe(200);
    expect(mocks.reorderProductImages).toHaveBeenCalledWith("org_zorro", PRODUCT, ["pimg_b", "pimg_a"]);
    expect(mocks.setPrimaryProductImage).toHaveBeenCalledWith("org_zorro", "pimg_a");
  });

  it("una imagen elegida que no es del producto sale 404", async () => {
    mocks.setPrimaryProductImage.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "Imagen no encontrada",
    });
    const res = await PATCH(json("PATCH", { primaryId: "pimg_de_otro" }), ctx({ id: PRODUCT }));
    expect(res.status).toBe(404);
  });

  it("un orderedIds de más de 30 no se acepta", async () => {
    const res = await PATCH(
      json("PATCH", { orderedIds: Array.from({ length: 40 }, (_, i) => `pimg_${i}`) }),
      ctx({ id: PRODUCT })
    );
    expect(res.status).toBe(422);
    expect(mocks.reorderProductImages).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/catalog/images/[imageId]", () => {
  it("borra la foto del negocio de la sesión", async () => {
    mocks.deleteProductImage.mockResolvedValue({ ok: true });
    const res = await DELETE(bare(), ctx({ imageId: "pimg_1" }));
    expect(res.status).toBe(200);
    expect(mocks.deleteProductImage).toHaveBeenCalledWith("org_zorro", "pimg_1");
  });

  it("una id de otro negocio es 404, no un ok falso", async () => {
    mocks.deleteProductImage.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "Imagen no encontrada",
    });
    expect((await DELETE(bare(), ctx({ imageId: "pimg_ajena" }))).status).toBe(404);
  });

  it("sin sesión no se llega al servicio", async () => {
    mocks.requireSession.mockRejectedValue(new mocks.UnauthorizedError());
    const res = await DELETE(bare(), ctx({ imageId: "pimg_1" }));
    expect(res.status).toBe(401);
    expect(mocks.deleteProductImage).not.toHaveBeenCalled();
  });
});
