"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Business = {
  id: string;
  name: string;
  slug: string | null;
  members: number;
  createdAt: string;
};

/**
 * Negocios de la instancia: alta de clientes y listado del porfolio.
 *
 * Solo se monta para quien opera la instancia (el owner de la organización más
 * antigua): el listado lee todas las organizaciones, algo que un cliente no debe
 * ver. Los demás owners siguen usando «Equipo» para su propio negocio.
 */
export function ClientBusinessesCard() {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string; business: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/clients").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { organizations: Business[] };
    setBusinesses(data.organizations);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function generatePassword() {
    const alphabet =
      "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(
      Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
    );
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    const res = await fetch("/api/settings/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessName, name, email, password: tempPassword }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear el cliente");
      return;
    }
    setCreated({ email, password: tempPassword, business: businessName });
    setBusinessName("");
    setName("");
    setEmail("");
    setTempPassword("");
    void refetch();
  }

  const ready =
    businessName.trim().length >= 2 &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    tempPassword.length >= 8;

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Negocios de la instancia
        </CardTitle>
        <CardDescription>
          Cada negocio es un tenant aislado: sus contactos, conversaciones,
          proyectos y datos de inteligencia no se ven entre sí. Alta aquí a tus
          clientes y entrega tú la contraseña temporal (se muestra una sola vez).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="client-business">Nombre del negocio del cliente</Label>
          <Input
            id="client-business"
            value={businessName}
            maxLength={120}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Peluquería Aurora"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Persona de contacto</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-email">Correo</Label>
            <Input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-password">Contraseña temporal</Label>
          <div className="flex gap-2">
            <Input
              id="client-password"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
            />
            <Button variant="outline" onClick={generatePassword}>
              Generar
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {created && (
          <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
            <p className="font-medium text-success-text">
              Negocio «{created.business}» creado ✓
            </p>
            <p className="mt-1 text-success-text opacity-90">
              Entrega estos datos ahora (no se volverán a mostrar):
              <br />
              <code>{created.email}</code> · contraseña <code>{created.password}</code>
            </p>
          </div>
        )}
        <Button disabled={saving || !ready} onClick={() => void create()}>
          <UserPlus className="h-4 w-4" />
          {saving ? "Creando…" : "Dar de alta cliente"}
        </Button>

        {businesses && businesses.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {businesses.length} negocio{businesses.length === 1 ? "" : "s"}
            </p>
            {businesses.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.members} cuenta{b.members === 1 ? "" : "s"} ·{" "}
                    {new Date(b.createdAt).toLocaleDateString("es-MX")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      </Card>
    </div>
  );
}
