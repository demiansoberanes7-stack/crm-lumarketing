/**
 * PDF del expediente de proyecto — documento estructurado real
 * (mismo motor pdf-lib que las cotizaciones: sin navegador).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBusinessSettings } from "@/server/business-settings";
import {
  clean,
  tryLoadLogo,
  wrapText,
  PAGE_W,
  PAGE_H,
  MARGIN,
  CONTENT_W,
} from "@/server/documents/pdf";
import {
  PROJECT_STATUS_LABELS,
  findStep,
  formatFieldValue,
  getProjectType,
  stepsForType,
  type ProjectStatus,
} from "@/lib/project-types";
import { getProject, listTasks } from "./service";
import { listProjectSteps } from "./steps";

const DARK = rgb(0.13, 0.13, 0.13);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.88, 0.88, 0.88);
const HEADER_BG = rgb(0.28, 0.28, 0.28);
const GOLD = rgb(0.72, 0.59, 0.24);

export async function projectPdf(
  organizationId: string,
  projectId: string
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const project = await getProject(organizationId, projectId);
  if (!project) return null;

  const [bs, stepResult, tasks] = await Promise.all([
    getBusinessSettings(organizationId),
    listProjectSteps(organizationId, projectId),
    listTasks(organizationId, projectId),
  ]);

  const db = getDb();
  const [contact] = project.contactId
    ? await db
        .select({ name: schema.contact.name, phone: schema.contact.phone })
        .from(schema.contact)
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            eq(schema.contact.id, project.contactId)
          )
        )
        .limit(1)
    : [];
  const [assignee] = project.assignedUserId
    ? await db
        .select({ name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, project.assignedUserId))
        .limit(1)
    : [];
  const taskAssigneeIds = [...new Set(tasks.flatMap((task) => task.assigneeId ? [task.assigneeId] : []))];
  const taskAssignees = taskAssigneeIds.length
    ? await db
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(and(eq(schema.member.organizationId, organizationId), inArray(schema.user.id, taskAssigneeIds)))
    : [];
  const taskAssigneeById = new Map(taskAssignees.map((user) => [user.id, user]));

  const type = getProjectType(project.projectType);
  const status = (project.status as ProjectStatus) ?? "borrador";
  const defs = stepsForType(project.projectType);
  const completed = stepResult.steps.filter((s) => s.status === "completado").length;

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Proyecto ${project.code}`);
  doc.setAuthor(bs.companyName || "LUMARK");

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const checkPage = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const line = (text: string, font = regular, size = 9, color = GRAY, x = MARGIN) => {
    const lines = wrapText(text, font, size, PAGE_W - MARGIN - x);
    checkPage(lines.length * (size + 4) + 6);
    for (const l of lines) {
      page.drawText(clean(l), { x, y, size, font, color });
      y -= size + 4;
    }
  };

  const label = (text: string) => {
    checkPage(18);
    page.drawText(clean(text), { x: MARGIN, y, size: 9, font: bold, color: DARK });
    y -= 14;
  };

  const dateStr = (d: Date | string | null): string => {
    if (!d) return "—";
    const date = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  };

  // ─── HEADER ───
  const companyName = bs.companyName || "LUMARK";
  // El nombre no debe invadir la columna derecha (EXPEDIENTE / código / fecha).
  const rightColX = PAGE_W - MARGIN - 160;
  const fit = (size: number): string => {
    const maxW = rightColX - MARGIN - 12;
    const t = clean(companyName);
    if (bold.widthOfTextAtSize(t, size) <= maxW) return t;
    let out = t;
    while (out.length > 1 && bold.widthOfTextAtSize(`${out}...`, size) > maxW) out = out.slice(0, -1);
    return `${out}...`;
  };
  const logoData = tryLoadLogo(bs.logoUrl, organizationId);
  let logoDrawn = false;
  if (logoData && (logoData.mime === "image/png" || logoData.mime === "image/jpeg")) {
    try {
      const img =
        logoData.mime === "image/png"
          ? await doc.embedPng(logoData.data)
          : await doc.embedJpg(logoData.data);
      const scale = 40 / img.height;
      page.drawImage(img, {
        x: MARGIN,
        y: y - img.height * scale + 5,
        width: img.width * scale,
        height: img.height * scale,
      });
      page.drawText(fit(14), {
        x: MARGIN,
        y: y - 48,
        size: 14,
        font: bold,
        color: DARK,
      });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    page.drawText(fit(18), { x: MARGIN, y, size: 18, font: bold, color: DARK });
  }

  page.drawText("EXPEDIENTE DE PROYECTO", {
    x: rightColX,
    y,
    size: 13,
    font: bold,
    color: DARK,
  });
  page.drawText(project.code, {
    x: rightColX,
    y: y - 14,
    size: 9,
    font: regular,
    color: GRAY,
  });
  page.drawText(`Actualizado: ${dateStr(project.updatedAt)}`, {
    x: rightColX,
    y: y - 27,
    size: 9,
    font: regular,
    color: GRAY,
  });
  y -= logoDrawn ? 66 : 34;
  page.drawLine({
    start: { x: MARGIN, y: y + 8 },
    end: { x: PAGE_W - MARGIN, y: y + 8 },
    color: GOLD,
    thickness: 1,
  });
  // Respiro entre la línea dorada y el título (16pt) para que nunca se crucen.
  y -= 22;

  // ─── TÍTULO + RESUMEN ───
  checkPage(80);
  for (const l of wrapText(project.name, bold, 16, CONTENT_W)) {
    page.drawText(clean(l), { x: MARGIN, y, size: 16, font: bold, color: DARK });
    y -= 20;
  }
  y -= 4;
  page.drawText(`Tipo: ${type?.label ?? project.projectType}`, {
    x: MARGIN,
    y,
    size: 10,
    font: bold,
    color: DARK,
  });
  page.drawText(`Estado: ${PROJECT_STATUS_LABELS[status] ?? status}`, {
    x: MARGIN + 140,
    y,
    size: 10,
    font: bold,
    color: DARK,
  });
  page.drawText(`Avance: ${project.avance}%`, {
    x: MARGIN + 320,
    y,
    size: 10,
    font: bold,
    color: DARK,
  });
  y -= 24;

  // ─── DATOS GENERALES (2 columnas; omitir campos sin información) ───
  checkPage(110);
  const leftCol = MARGIN;
  const rightCol = MARGIN + CONTENT_W / 2 + 10;

  const leftEntries: [string, string][] = ([
    ["Servicio", project.service ?? ""],
    ["Prioridad", project.prioridad ?? ""],
    ["Riesgo", project.riesgo ?? ""],
    ["Progreso", `${completed} de ${defs.length} pasos completados (${project.avance}%)`],
  ] as [string, string][]).filter((entry) => entry[1].trim().length > 0);
  const rightEntries: [string, string][] = ([
    ["Cliente", contact ? `${contact.name ?? "Sin nombre"}${contact.phone ? ` · ${contact.phone}` : ""}` : ""],
    ["Responsable", assignee ? assignee.name || assignee.email : ""],
    ["Inicio", dateStr(project.startDate)],
    ["Término", dateStr(project.endDate)],
  ] as [string, string][]).filter((entry) => entry[1].trim().length > 0 && entry[1] !== "—");
  if (leftEntries.length) page.drawText("DATOS GENERALES", { x: leftCol, y, size: 9, font: bold, color: DARK });
  if (rightEntries.length) page.drawText("PARTES Y FECHAS", { x: rightCol, y, size: 9, font: bold, color: DARK });
  y -= 16;
  const startY = y;
  let leftY = startY;
  for (const [k, v] of leftEntries) {
    page.drawText(clean(k), { x: leftCol, y: leftY, size: 8, font: bold, color: GRAY });
    leftY -= 12;
    for (const l of wrapText(v || "—", regular, 10, CONTENT_W / 2 - 20)) {
      page.drawText(clean(l), { x: leftCol, y: leftY, size: 10, font: regular, color: DARK });
      leftY -= 13;
    }
    leftY -= 4;
  }
  y = startY;
  for (const [k, v] of rightEntries) {
    page.drawText(clean(k), { x: rightCol, y, size: 8, font: bold, color: GRAY });
    y -= 12;
    for (const l of wrapText(v || "—", regular, 10, CONTENT_W / 2 - 20)) {
      page.drawText(clean(l), { x: rightCol, y, size: 10, font: regular, color: DARK });
      y -= 13;
    }
    y -= 4;
  }
  y = Math.min(y, leftY) - 8;

  // ─── DESCRIPCIÓN ───
  if (project.notas?.trim()) {
    label("DESCRIPCIÓN");
    line(project.notas, regular, 9, GRAY);
    y -= 6;
  }

  // ─── PASOS DEL EXPEDIENTE ───
  checkPage(60);
  page.drawText("PROCESO DEL PROYECTO", { x: MARGIN, y, size: 10, font: bold, color: DARK });
  y -= 16;

  stepResult.steps.forEach((step, index) => {
    // Los datos generales ya están presentados arriba con nombres legibles.
    // No imprimir su payload técnico (IDs de contacto/usuario) en el expediente.
    if (step.key === "general") return;

    checkPage(40);
    page.drawRectangle({
      x: MARGIN,
      y: y - 6,
      width: CONTENT_W,
      height: 20,
      color: HEADER_BG,
    });
    page.drawText(clean(`${index + 1}. ${step.label}`), {
      x: MARGIN + 8,
      y,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    const statusText =
      step.status === "completado" ? "Completado" : step.status === "en_proceso" ? "En proceso" : "Pendiente";
    page.drawText(statusText, {
      x: PAGE_W - MARGIN - 74,
      y,
      size: 9,
      font: regular,
      color: rgb(1, 1, 1),
    });
    y -= 26;

    const def = findStep(project.projectType, step.key);
    if (def && step.status !== "pendiente") {
      for (const field of def.fields) {
        const text = formatFieldValue(field, step.data[field.key]);
        if (!text) continue;
        checkPage(30);
        page.drawText(clean(field.label), { x: MARGIN + 8, y, size: 8, font: bold, color: GRAY });
        y -= 11;
        for (const l of wrapText(text, regular, 9, CONTENT_W - 24)) {
          page.drawText(clean(l), { x: MARGIN + 8, y, size: 9, font: regular, color: DARK });
          y -= 12;
        }
        y -= 3;
      }
    } else if (def) {
      page.drawText("Sin información capturada", {
        x: MARGIN + 8,
        y,
        size: 9,
        font: regular,
        color: GRAY,
      });
      y -= 14;
    }
    y -= 6;
  });

  // ─── TAREAS ───
  if (tasks.length) {
    const done = tasks.filter((t) => t.estado === "terminado").length;
    label("TAREAS");
    line(`Total: ${tasks.length} · Terminadas: ${done} · Pendientes: ${tasks.length - done}`);

    for (const task of tasks) {
      const statusText = task.estado === "terminado" ? "Terminada" : "Pendiente";
      const statusColor = task.estado === "terminado" ? rgb(0.12, 0.48, 0.28) : rgb(0.62, 0.39, 0.08);
      const priorityText = task.priority
        ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1)
        : "Normal";
      const assignee = task.assigneeId ? taskAssigneeById.get(task.assigneeId) : undefined;
      const metadata = [
        task.dueDate ? `Entrega: ${dateStr(task.dueDate)}` : "",
        assignee ? `Responsable: ${assignee.name || assignee.email}` : "",
      ].filter(Boolean).join(" · ");
      const description = task.description?.trim();
      const titleLines = wrapText(task.title, bold, 10, CONTENT_W - 12);
      const metadataLines = metadata ? wrapText(metadata, regular, 8, CONTENT_W - 12) : [];
      const descriptionLines = description ? wrapText(description, regular, 9, CONTENT_W - 24) : [];
      const required =
        titleLines.length * 14 + 16 + metadataLines.length * 12 +
        (description ? 12 + descriptionLines.length * 13 : 0) + 12;

      // Reservar el bloque antes de empezarlo; las líneas extensas siguen
      // verificando el espacio individualmente y pueden continuar en otra página.
      checkPage(required);
      for (const titleLine of titleLines) {
        checkPage(14);
        page.drawText(clean(titleLine), { x: MARGIN + 8, y, size: 10, font: bold, color: DARK });
        y -= 13;
      }
      checkPage(14);
      page.drawText(`[${statusText}]`, { x: MARGIN + 8, y, size: 8, font: bold, color: statusColor });
      page.drawText(`Prioridad: ${clean(priorityText)}`, {
        x: MARGIN + 88,
        y,
        size: 8,
        font: regular,
        color: GRAY,
      });
      y -= 12;

      if (metadata) line(metadata, regular, 8, GRAY, MARGIN + 8);
      if (description) {
        checkPage(14);
        page.drawText("Descripción", { x: MARGIN + 8, y, size: 8, font: bold, color: GRAY });
        y -= 11;
        line(description, regular, 9, DARK, MARGIN + 8);
      }
      y -= 8;
    }
  }

  // ─── FOOTER ───
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    p.drawLine({
      start: { x: MARGIN, y: 42 },
      end: { x: PAGE_W - MARGIN, y: 42 },
      color: LIGHT_GRAY,
      thickness: 0.5,
    });
    const parts: string[] = [];
    if (bs.email) parts.push(bs.email);
    if (bs.phone) parts.push(bs.phone);
    if (bs.rfc) parts.push(`RFC: ${bs.rfc}`);
    if (bs.address) parts.push(bs.address);
    if (bs.website) parts.push(bs.website);
    if (parts.length) {
      p.drawText(clean(parts.join("   |   ")).slice(0, 120), {
        x: MARGIN,
        y: 30,
        size: 8,
        font: regular,
        color: GRAY,
      });
    }
    p.drawText(`${project.code}  ·  ${i + 1} / ${pages.length}`, {
      x: PAGE_W - MARGIN - 90,
      y: 30,
      size: 8,
      font: regular,
      color: GRAY,
    });
  }

  return { bytes: await doc.save(), filename: `${project.code}.pdf` };
}
