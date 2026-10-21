import { and, count, desc, eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { updateContact } from "@/server/contacts";
import { BROADCAST_AUDIENCE_LIMIT, resolveBroadcastAudience } from "@/server/broadcasts/audience";
import { createBroadcastSchema } from "@/server/broadcasts/filters";
import { capabilitiesFor, textFits } from "@/server/channels/capabilities";
import {
  findApprovedWhatsappTemplate,
  templateRequiresOptIn,
  type WhatsappTemplate,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const campaigns = await db
    .select()
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, session.organizationId))
    .orderBy(desc(schema.broadcastCampaign.createdAt))
    .limit(100);
  // Los que esperan ventana siguen pendientes: la lista los muestra aparte
  // para no confundirlos con omitidos definitivos.
  const waiting = await db
    .select({
      campaignId: schema.broadcastRecipient.campaignId,
      total: count(),
    })
    .from(schema.broadcastRecipient)
    .where(
      and(
        scoped(schema.broadcastRecipient.organizationId, session.organizationId),
        eq(schema.broadcastRecipient.status, "waiting_window")
      )
    )
    .groupBy(schema.broadcastRecipient.campaignId);
  const waitingByCampaign = new Map(
    waiting.map((row) => [row.campaignId, Number(row.total)])
  );
  return Response.json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      waitingCount: waitingByCampaign.get(campaign.id) ?? 0,
    })),
  });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createBroadcastSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  /**
   * Plantilla: se valida contra el proveedor ANTES de guardar la lista. Solo
   * una plantilla aprobada puede viajar fuera de la ventana; guardar un
   * nombre inventado haría fallar a todos los destinatarios.
   */
  let template: WhatsappTemplate | null = null;
  if (input.templateName) {
    try {
      template = await findApprovedWhatsappTemplate(
        session.organizationId,
        input.templateName,
        input.templateLanguage ?? ""
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudieron leer las plantillas";
      return apiError(422, "template_provider", message);
    }
    if (!template) {
      return apiError(
        422,
        "template_not_approved",
        "Esa plantilla no está aprobada por Meta (o no existe en este número). Elige una de la lista o espera su aprobación."
      );
    }
    const params = input.templateParams ?? [];
    if (params.length !== template.variableCount) {
      return apiError(
        422,
        "template_params",
        `La plantilla espera ${template.variableCount} variable(s) y se enviaron ${params.length}`
      );
    }
    if (template.automationIssue) {
      return apiError(
        422,
        "template_unsupported",
        `Esta plantilla no se puede enviar desde campañas: ${template.automationIssue}.`
      );
    }
    if (template.headerMediaRequired && !input.templateHeaderMediaUrl) {
      return apiError(
        422,
        "template_header_media",
        "Esta plantilla necesita un enlace público https para el encabezado (imagen, video o documento)."
      );
    }
    if (!template.headerMediaRequired && input.templateHeaderMediaUrl) {
      return apiError(
        422,
        "template_header_not_needed",
        "Esa plantilla no usa encabezado multimedia: quita el enlace."
      );
    }
  }
  if (input.optInConfirmed && !templateRequiresOptIn(template?.category)) {
    return apiError(
      422,
      "opt_in_not_needed",
      "El consentimiento solo se registra al usar una plantilla de marketing"
    );
  }

  // Envío individual desde Contactos: el operador atestigua el consentimiento
  // y queda registrado en la ficha. En campañas masivas NO se acepta: cada
  // contacto debe tener su propio opt-in.
  const singleContactId = input.filters.contactIds?.length === 1
    ? input.filters.contactIds[0]
    : null;
  if (input.optInConfirmed && singleContactId) {
    const saved = await updateContact({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      contactId: singleContactId,
      waMarketingOptIn: true,
    });
    if (!saved.ok) {
      return apiError(
        saved.code === "not_found" ? 404 : 422,
        saved.code,
        saved.message
      );
    }
  }

  const filters = { ...input.filters };
  // Una plantilla de marketing solo puede ir a quienes dieron su opt-in.
  if (templateRequiresOptIn(template?.category)) {
    filters.optInOnly = true;
  }

  // El texto de una campaña con plantilla es el cuerpo aprobado: es lo que se
  // renderiza por destinatario (los parámetros pueden traer {{nombre}}).
  const messageText = template
    ? template.bodyText.trim() || input.messageText || template.name
    : input.messageText ?? "";

  // El texto tiene que caber en el canal elegido ANTES de guardar la lista:
  // si no cabe, todos los destinatarios fallarían al enviar. Las plantillas de
  // WhatsApp no tienen este límite.
  if (!template && !textFits(input.channel, messageText)) {
    const caps = capabilitiesFor(input.channel);
    return apiError(
      422,
      "broadcast_text_too_long",
      `${caps.label} no acepta mensajes de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  let recipients;
  try {
    recipients = await resolveBroadcastAudience(
      session.organizationId,
      filters,
      input.channel,
      { hasTemplate: Boolean(template) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo calcular el segmento";
    return apiError(422, "broadcast_audience", message);
  }
  if (recipients.length === 0) {
    return apiError(422, "broadcast_empty", "El segmento no contiene contactos para guardar");
  }
  if (recipients.length > BROADCAST_AUDIENCE_LIMIT) {
    return apiError(422, "broadcast_limit", "El segmento supera el límite por campaña");
  }

  const db = getDb();
  const now = new Date();
  // Si se programó una fecha futura, ese es el scheduledAt de la campaña y de
  // cada destinatario; el worker solo procesa scheduled_at <= now. La campaña
  // nace en "sending" para que el worker la espere hasta la hora programada.
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : now;
  const isScheduled = scheduledAt.getTime() > now.getTime();
  const id = newId("broadcastCampaign");
  const skippedCount = recipients.filter((recipient) => recipient.status === "skipped").length;
  const waitingCount = recipients.filter((recipient) => recipient.status === "waiting_window").length;
  await db.transaction(async (tx) => {
    await tx.insert(schema.broadcastCampaign).values({
      id,
      organizationId: session.organizationId,
      name: input.name,
      channel: input.channel,
      messageText,
      filters,
      status: isScheduled ? "sending" : "draft",
      recipientCount: recipients.length,
      skippedCount,
      scheduledAt,
      startedAt: isScheduled ? now : null,
      templateName: template?.name ?? null,
      templateLanguage: template?.language ?? null,
      templateParams: template ? (input.templateParams ?? []) : null,
      templateCategory: template?.category ?? null,
      templateHeaderFormat:
        template?.headerMediaRequired ? template.headerFormat : null,
      templateHeaderMediaUrl:
        template?.headerMediaRequired ? input.templateHeaderMediaUrl ?? null : null,
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    });

    for (let offset = 0; offset < recipients.length; offset += 250) {
      await tx.insert(schema.broadcastRecipient).values(
        recipients.slice(offset, offset + 250).map((recipient) => ({
          id: newId("broadcastRecipient"),
          organizationId: session.organizationId,
          campaignId: id,
          contactId: recipient.contactId,
          conversationId: recipient.conversationId,
          channel: recipient.channel,
          status: recipient.status,
          skipReason: recipient.skipReason,
          scheduledAt,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
  });

  return Response.json({
    campaign: {
      id,
      name: input.name,
      channel: input.channel,
      status: isScheduled ? "sending" : "draft",
      scheduledAt: scheduledAt.toISOString(),
      recipientCount: recipients.length,
      skippedCount,
      waitingCount,
      templateName: template?.name ?? null,
      templateCategory: template?.category ?? null,
    },
  }, { status: 201 });
});
