import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { mediaHeaders, resolveMediaFile } from "@/server/media-path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png:  "image/png",
  svg:  "image/svg+xml",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif:  "image/gif",
};

/**
 * Serve media assets publicly (logos, catalog images, etc.).
 * Supports nested paths: /api/media/public/[orgId]/catalog/[filename]
 * Path: /api/media/public/[orgId]/[...path]
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; path: string[] }> }
) {
  const { orgId, path } = await params;

  // Cada segmento se valida y la ruta resuelta debe quedar dentro de
  // MEDIA_DIR/{orgId}: ver src/server/media-path.ts.
  const filePath = resolveMediaFile(orgId, ...path);
  if (!filePath) {
    return NextResponse.json({ error: "invalid path" }, { status: 422 });
  }

  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ext = path.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(data), { headers: mediaHeaders(mime) });
}
