import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError, sendText, sendMediaMessage } from "@/server/inbox/send";
import { validateOutgoing } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/3gpp",
  "audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg", "audio/opus",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE = 16 * 1024 * 1024;

export const POST = withAuth(async (session, req: Request) => {
  let contactIdsRaw: string;
  let message: string;
  let file: File | null = null;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    contactIdsRaw = formData.get("contactIds") as string;
    message = formData.get("message") as string;
    file = formData.get("file") instanceof File ? (formData.get("file") as File) : null;
    if (file && file.size === 0) file = null;
  } else {
    const body = await req.json() as { contactIds?: string[]; message?: string };
    contactIdsRaw = JSON.stringify(body.contactIds ?? []);
    message = body.message ?? "";
  }

  if (!message?.trim()) {
    return apiError(422, "empty_message", "El mensaje no puede estar vacio");
  }

  let parsedIds: string[];
  try {
    parsedIds = JSON.parse(contactIdsRaw) as string[];
  } catch {
    return apiError(422, "invalid_ids", "Ids de contacto invalidos");
  }

  if (!Array.isArray(parsedIds) || parsedIds.length === 0 || parsedIds.length > 100) {
    return apiError(422, "invalid_ids", "Selecciona entre 1 y 100 contactos");
  }

  if (file) {
    if (file.size > MAX_SIZE) {
      return apiError(413, "too_large", "El archivo supera 16MB");
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return apiError(415, "unsupported_type", "Tipo de archivo no soportado");
    }
  }

  const db = getDb();
  const contacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, session.organizationId)
    )
    .limit(200);

  const validIds = new Set(contacts.map((c) => c.id));
  const targetIds = parsedIds.filter((id) => validIds.has(id));

  if (targetIds.length === 0) {
    return apiError(422, "no_contacts", "Ningun contacto valido seleccionado");
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const contactId of targetIds) {
    try {
      const conversation = await getOrCreateConversation(
        session.organizationId,
        contactId
      );

      if (file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        validateOutgoing(file.type, buffer.byteLength);
        if (message.trim()) {
          await sendText({
            conversationId: conversation.id,
            organizationId: session.organizationId,
            text: message,
          });
        }
        await sendMediaMessage({
          conversationId: conversation.id,
          organizationId: session.organizationId,
          file: { data: buffer, mimeType: file.type, fileName: file.name },
          caption: message.trim() || undefined,
        });
      } else {
        await sendText({
          conversationId: conversation.id,
          organizationId: session.organizationId,
          text: message,
        });
      }
      sent++;
    } catch (err) {
      failed++;
      if (err instanceof SendError) {
        errors.push(`${contactId}: ${err.message}`);
      } else {
        errors.push(`${contactId}: Error desconocido`);
      }
    }
  }

  return Response.json({
    sent,
    failed,
    message: `${sent} mensaje${sent !== 1 ? "s" : ""} enviado${sent !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} fallido${failed !== 1 ? "s" : ""}` : ""}`,
    errors: errors.length > 0 ? errors : undefined,
  });
});
