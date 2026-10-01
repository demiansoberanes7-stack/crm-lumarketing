import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getIntegration, saveIntegration, deleteIntegration, type IntegrationProvider } from "@/server/integrations";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (session, _req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = (await params).provider as IntegrationProvider;
    const integration = await getIntegration(session.organizationId, provider);
    if (!integration) return NextResponse.json(null);
    return NextResponse.json({ credentials: integration.credentials });
  }
);

export const POST = withAuth(
  async (session, req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = (await params).provider as IntegrationProvider;
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    await saveIntegration(session.organizationId, provider, body as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  }
);

export const DELETE = withAuth(
  async (session, _req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = (await params).provider as IntegrationProvider;
    await deleteIntegration(session.organizationId, provider);
    return NextResponse.json({ ok: true });
  }
);
