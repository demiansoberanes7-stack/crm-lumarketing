import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

/**
 * Serve business logos. Public endpoint (no auth) — logos are not sensitive.
 * Path: /api/media/public/[orgId]/[filename]
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; filename: string }> }
) {
  const { orgId, filename } = await params;
  // Basic sanitization
  if (!/^[\w-]{1,64}$/.test(orgId) || !/^[\w.-]{1,32}$/.test(filename)) {
    return NextResponse.json({ error: "invalid path" }, { status: 422 });
  }

  const filePath = join(MEDIA_DIR, orgId, filename);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const data = readFileSync(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();
  const mime =
    ext === "png" ? "image/png" :
    ext === "svg" ? "image/svg+xml" :
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    "application/octet-stream";

  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": mime,
      "cache-control": "public, max-age=86400",
    },
  });
}
