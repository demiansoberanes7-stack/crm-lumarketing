import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { mediaHeaders, resolveMediaFile } from "@/server/media-path";

export const dynamic = "force-dynamic";

/**
 * Serve business logos. Public endpoint (no auth) — logos are not sensitive.
 * Path: /api/media/public/[orgId]/[filename]
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; filename: string }> }
) {
  const { orgId, filename } = await params;
  // Segmento validado y ruta contenida en MEDIA_DIR/{orgId}: ver src/server/media-path.ts.
  const filePath = resolveMediaFile(orgId, filename);
  if (!filePath) {
    return NextResponse.json({ error: "invalid path" }, { status: 422 });
  }

  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  const mime =
    ext === "png" ? "image/png" :
    ext === "svg" ? "image/svg+xml" :
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    "application/octet-stream";

  return new Response(new Uint8Array(data), { headers: mediaHeaders(mime) });
}
