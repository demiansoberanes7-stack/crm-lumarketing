import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

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

  // Validate orgId
  if (!/^[\w-]{1,64}$/.test(orgId)) {
    return NextResponse.json({ error: "invalid path" }, { status: 422 });
  }

  // Validate each segment (no directory traversal)
  if (!path || path.some((seg) => !/^[\w.-]{1,128}$/.test(seg))) {
    return NextResponse.json({ error: "invalid path" }, { status: 422 });
  }

  const filePath = join(MEDIA_DIR, orgId, ...path);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const data = readFileSync(filePath);
  const ext = path.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": mime,
      "cache-control": "public, max-age=86400",
    },
  });
}
