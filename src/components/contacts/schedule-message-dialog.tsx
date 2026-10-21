"use client";

import { useState } from "react";
import { CalendarClock, X } from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  WhatsappTemplatePicker,
  templateReady,
  templateRequiresOptIn,
  useWhatsappTemplates,
  type WhatsappTemplateDto,
} from "@/components/whatsapp/template-picker";

/**
 * Programar un mensaje personalizado a un contacto específico.
 * Usa el sistema de broadcasts: crea una campaña con un solo destinatario
 * y `scheduledAt` en el futuro; el worker la enviará cuando llegue la hora.
 *
 * Legalidad: fuera de la ventana de 24 h de WhatsApp solo sale una plantilla
 * aprobada (marketing con opt-in). En el resto de canales, si la ventana está
 * cerrada a esa hora, la fila espera al siguiente mensaje del cliente y se
 * envía en cuanto se abre; nunca se usa la etiqueta de agente humano.
 */
export function ScheduleMessageDialog({
  contact,
  onClose,
}: {
  contact: ContactDto;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [template, setTemplate] = useState<WhatsappTemplateDto | null>(null);
  const [templateParams, setTemplateParams] = useState<string[]>([]);
  const [templateHeaderMediaUrl, setTemplateHeaderMediaUrl] = useState("");
  const [optInConfirmed, setOptInConfirmed] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const channel = (contact.channel || "whatsapp") as Channel;
  const channelLabel = CHANNEL_LABEL[channel] ?? contact.channel;
  const isWhatsapp = channel === "whatsapp";
  const templatesState = useWhatsappTemplates(isWhatsapp && useTemplate);
  const marketing = templateRequiresOptIn(template?.category);
  const alreadyOptedIn = Boolean(contact.waMarketingOptInAt);
  const needsOptIn = useTemplate && marketing && !alreadyOptedIn;

  function chooseTemplate(next: WhatsappTemplateDto | null) {
    setTemplate(next);
    setTemplateParams(next ? Array.from({ length: next.variableCount }, () => "") : []);
    setTemplateHeaderMediaUrl("");
    setOptInConfirmed(false);
  }

  const contentReady = useTemplate && isWhatsapp
    ? templateReady(template, templateParams, templateHeaderMediaUrl) &&
      (!marketing || alreadyOptedIn || optInConfirmed)
    : message.trim().length > 0;

  async function guardar() {
    setSaving(true);
    setError(null);
    const iso = `${date}T${time}:00`;
    const scheduledAt = new Date(iso);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setSaving(false);
      setError("Elige una fecha y hora en el futuro.");
      return;
    }
    const sendingTemplate = useTemplate && isWhatsapp ? template : null;
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `Programado · ${contact.name}`,
        channel,
        filters: { contactIds: [contact.id] },
        scheduledAt: scheduledAt.toISOString(),
        ...(sendingTemplate
          ? {
              templateName: sendingTemplate.name,
              templateLanguage: sendingTemplate.language,
              templateParams,
              templateCategory: sendingTemplate.category ?? undefined,
              ...(sendingTemplate.headerMediaRequired
                ? { templateHeaderMediaUrl }
                : {}),
              ...(marketing && optInConfirmed ? { optInConfirmed: true } : {}),
            }
          : { messageText: message.trim() }),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo programar el mensaje.");
      return;
    }
    setOk(true);
  }

  if (ok) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-label="Mensaje programado"
          className="w-full max-w-sm rounded-lg border bg-card p-5 text-center shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-success" />
          <p className="font-semibold">Mensaje programado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Se enviará a <strong>{contact.name}</strong> por {channelLabel} el{" "}
            {new Date(`${date}T${time}`).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
            {template ? ` con la plantilla «${template.name}».` : "."}
          </p>
          {!template && (
            <p className="mt-2 text-xs text-muted-foreground">
              Si la ventana de atención está cerrada a esa hora, el envío queda
              en espera y sale en cuanto {contact.name} vuelva a escribir.
            </p>
          )}
          <Button className="mt-4" onClick={onClose}>Entendido</Button>
        </div>
      </div>
    );
  }

  // Mínimo: ahora + 5 minutos (el worker tarda ~2s por tick).
  const minDate = new Date(Date.now() + 5 * 60_000);
  const minDateStr = minDate.toISOString().slice(0, 10);
  const minTimeStr = date === minDateStr
    ? `${String(minDate.getHours()).padStart(2, "0")}:${String(minDate.getMinutes()).padStart(2, "0")}`
    : "00:00";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Programar mensaje a ${contact.name}`}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Programar mensaje</h3>
            <p className="text-sm text-muted-foreground">
              A <strong>{contact.name}</strong> · por {channelLabel}
            </p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {isWhatsapp && (
            <label className="flex items-start gap-2 rounded-lg border bg-subtle px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={useTemplate}
                onChange={(event) => {
                  setUseTemplate(event.target.checked);
                  if (!event.target.checked) chooseTemplate(null);
                }}
              />
              <span>
                <span className="font-medium">Enviar con plantilla aprobada</span>
                <span className="block text-xs text-muted-foreground">
                  Garantiza el envío aunque la ventana de 24 h esté cerrada.
                </span>
              </span>
            </label>
          )}

          {useTemplate && isWhatsapp ? (
            <WhatsappTemplatePicker
              templates={templatesState.templates}
              provider={templatesState.provider}
              loading={templatesState.loading}
              error={templatesState.error}
              onReload={templatesState.reload}
              selected={template}
              params={templateParams}
              onSelect={chooseTemplate}
              onParamsChange={setTemplateParams}
              headerMediaUrl={templateHeaderMediaUrl}
              onHeaderMediaUrlChange={setTemplateHeaderMediaUrl}
              contactName={contact.name}
              idPrefix="schedule"
            />
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sm-msg">
                Mensaje
              </label>
              <Textarea
                id="sm-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hola, te escribimos para recordarte…"
              />
            </div>
          )}

          {needsOptIn && (
            <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-snug text-amber-800">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={optInConfirmed}
                onChange={(event) => setOptInConfirmed(event.target.checked)}
              />
              <span>
                Confirmo que <strong>{contact.name}</strong> autorizó recibir
                promociones por WhatsApp. Quedará registrado en su ficha.
              </span>
            </label>
          )}
          {useTemplate && marketing && alreadyOptedIn && (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
              Este contacto ya tiene opt-in de marketing registrado
              {contact.waMarketingOptInAt
                ? ` el ${new Date(contact.waMarketingOptInAt).toLocaleDateString("es-MX")}`
                : ""}
              .
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sm-date">
                Fecha
              </label>
              <Input
                id="sm-date"
                type="date"
                value={date}
                min={minDateStr}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sm-time">
                Hora
              </label>
              <Input
                id="sm-time"
                type="time"
                value={time}
                min={minTimeStr}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {template
              ? `${channelLabel} acepta esta plantilla aprobada fuera de la ventana de atención.`
              : `Si la ventana de atención de ${channelLabel} está cerrada a esa hora, el mensaje queda en espera y sale en cuanto el contacto vuelva a escribir.`}
          </p>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!contentReady || !date || !time || saving}
            onClick={() => void guardar()}
          >
            <CalendarClock className="mr-1.5 h-4 w-4" />
            {saving ? "Programando…" : "Programar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
