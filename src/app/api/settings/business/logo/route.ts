import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { withAuth } from "@/lib/api";
import { getBusinessSettings, saveBusinessSettings } from "@/server/business-settings";

export const dynamic = "force-dynamic";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

export const POST = withAuth(async (session, req: Request) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json({ error: { code: "invalid_type", message: "Se esperaba multipart/form-data" } }, { status: 422 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: { code: "missing_file", message: "Archivo no proporcionado" } }, { status: 422 });
  }

  const mime = file.type;
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/svg+xml") {
    return Response.json({ error: { code: "invalid_type", message: "Formato no soportado. Usa PNG, JPG o SVG." } }, { status: 422 });
  }

  const orgDir = join(MEDIA_DIR, session.organizationId);
  if (!existsSync(orgDir)) mkdirSync(orgDir, { recursive: true });

  const ext = mime === "image/png" ? "png" : mime === "image/svg+xml" ? "svg" : "jpg";
  const filename = `logo.${ext}`;
  const filePath = join(orgDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(filePath, buffer);

  const logoUrl = `/api/media/public/${session.organizationId}/${filename}`;
  const current = await getBusinessSettings(session.organizationId);
  await saveBusinessSettings(session.organizationId, { ...current, logoUrl });

  return Response.json({ ok: true, logoUrl });
});
