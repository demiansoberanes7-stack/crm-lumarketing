import { apiError, withAuth } from "@/lib/api";
import {
  EmailImportError,
  EMAIL_AUDIENCE_LIMIT,
  EMAIL_IMPORT_MAX_BYTES,
  exceedsUploadBudget,
  parseRecipientFile,
} from "@/server/email-campaigns/recipients";

export const dynamic = "force-dynamic";

/**
 * Lee un .xlsx/.csv/.tsv/.txt y devuelve los correos normalizados.
 * El archivo no se guarda en disco: se parsea en memoria y se descarta.
 */
export const POST = withAuth(async (_session, req: Request) => {
  // Se mira antes de tocar el cuerpo: `formData()` materializaría la subida
  // completa en memoria y el límite del archivo llegaría tarde.
  if (exceedsUploadBudget(req.headers.get("content-length"))) {
    return apiError(
      413,
      "file_too_large",
      `El archivo supera el límite de ${Math.round(EMAIL_IMPORT_MAX_BYTES / 1024 / 1024)} MB.`
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(422, "invalid_body", "Envía el archivo como multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError(422, "file_missing", "Falta el archivo de destinatarios");
  }
  if (file.size > EMAIL_IMPORT_MAX_BYTES) {
    return apiError(
      422,
      "file_too_large",
      `El archivo supera el límite de ${Math.round(EMAIL_IMPORT_MAX_BYTES / 1024 / 1024)} MB.`
    );
  }
  try {
    const parsed = await parseRecipientFile({
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({
      filename: file.name,
      count: parsed.recipients.length,
      recipients: parsed.recipients.slice(0, EMAIL_AUDIENCE_LIMIT),
      rowsWithoutEmail: parsed.rowsWithoutEmail,
      overLimit: parsed.recipients.length > EMAIL_AUDIENCE_LIMIT,
      limit: EMAIL_AUDIENCE_LIMIT,
    });
  } catch (error) {
    if (error instanceof EmailImportError) {
      return apiError(422, error.code, error.message);
    }
    // read-excel-file lanza con detalles internos del ZIP: no se reenvían.
    return apiError(
      422,
      "file_unreadable",
      "No se pudo leer el archivo. Verifica que sea un .xlsx o CSV válido y que la primera hoja tenga los correos."
    );
  }
});
