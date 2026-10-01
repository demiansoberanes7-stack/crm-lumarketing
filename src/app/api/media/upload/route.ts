import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const EXT: Record<string, string> = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/webp": "webp",
  "image/gif":  "gif",
};

/** POST /api/media/upload — sube una imagen y devuelve la URL pública */
export const POST = withAuth(async (session, req: Request) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: { code: "invalid_type", message: "Se esperaba multipart/form-data" } },
      { status: 422 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: { code: "missing_file", message: "Archivo no proporcionado" } },
      { status: 422 }
    );
  }

  // Validar tipo de archivo
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: { code: "invalid_type", message: "Solo se permiten imágenes PNG, JPG, WEBP o GIF" } },
      { status: 422 }
    );
  }

  // Validar tamaño (máx. 5 MB)
  if (file.size > 5 * 1024 * 1024) {
    return Response.json(
      { error: { code: "file_too_large", message: "La imagen no puede superar los 5 MB" } },
      { status: 422 }
    );
  }

  const orgDir = join(MEDIA_DIR, session.organizationId, "catalog");
  if (!existsSync(orgDir)) mkdirSync(orgDir, { recursive: true });

  const ext = EXT[file.type] ?? "jpg";
  const filename = `${nanoid(12)}.${ext}`;
  const filePath = join(orgDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(filePath, buffer);

  const url = `/api/media/public/${session.organizationId}/catalog/${filename}`;
  return Response.json({ ok: true, url }, { status: 201 });
});
