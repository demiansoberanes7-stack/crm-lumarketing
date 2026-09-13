"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  initial?: { id: string; label: string | null; email: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; username: string };
};

export function NewAccountDialog({ open, onClose, onCreated, initial }: Props) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [imapHost, setImapHost] = useState(initial?.imapHost ?? "imap.hostinger.com");
  const [imapPort, setImapPort] = useState(String(initial?.imapPort ?? 993));
  const [smtpHost, setSmtpHost] = useState(initial?.smtpHost ?? "smtp.hostinger.com");
  const [smtpPort, setSmtpPort] = useState(String(initial?.smtpPort ?? 465));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(initial ? `/api/email/accounts/${initial.id}` : "/api/email/accounts", {
      method: initial ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        imapHost,
        imapPort: Number(imapPort),
        smtpHost,
        smtpPort: Number(smtpPort),
        username,
        password,
        label: label || undefined,
      }),
    }).catch(() => null);

    setLoading(false);

    if (!res) {
      setError("Sin conexión con el servidor");
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      return;
    }

    onCreated();
    resetForm();
  };

  const resetForm = () => {
    setLabel("");
    setEmail("");
    setImapHost("");
    setImapPort("993");
    setSmtpHost("");
    setSmtpPort("465");
    setUsername("");
    setPassword("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-overlay"
      />
      <div className="relative z-10 max-h-[90dvh] overflow-y-auto w-full max-w-md rounded-lg border border-border-strong bg-card p-6 shadow-lg">
        <h2 className="text-lg font-bold">{initial ? "Editar cuenta de correo" : "Nueva Cuenta de Correo"}</h2>
        <p className="mb-4 mt-1 text-sm text-text-2">
          Configura una cuenta IMAP/SMTP para recibir y enviar correos.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-label">Etiqueta (opcional)</Label>
            <Input
              id="email-label"
              placeholder="Ej: Soporte, Ventas..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-addr">Correo electrónico *</Label>
            <Input
              id="email-addr"
              type="email"
              required
              placeholder="correo@dominio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label htmlFor="imap-host">Servidor IMAP *</Label>
              <Input
                id="imap-host"
                required
                placeholder="imap.hostinger.com"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="imap-port">Puerto</Label>
              <Input
                id="imap-port"
                type="number"
                required
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label htmlFor="smtp-host">Servidor SMTP *</Label>
              <Input
                id="smtp-host"
                required
                placeholder="smtp.hostinger.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smtp-port">Puerto</Label>
              <Input
                id="smtp-port"
                type="number"
                required
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-user">Usuario *</Label>
            <Input
              id="email-user"
              required
              placeholder="correo@dominio.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-pass">Contraseña *</Label>
            <Input
              id="email-pass"
              type="password"
              required={!initial}
              placeholder={initial ? "Vacío para conservar la contraseña" : ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-danger-text">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
