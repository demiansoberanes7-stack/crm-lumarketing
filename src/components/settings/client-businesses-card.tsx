"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  KeyRound,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Person = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

type BusinessStats = {
  contacts: number;
  conversations: number;
  quotes: number;
  projects: number;
};

type Business = {
  id: string;
  name: string;
  slug: string | null;
  members: number;
  createdAt: string;
  isPrincipal: boolean;
  canDelete: boolean;
  people: Person[];
  stats: BusinessStats;
};

type ClientsResponse = {
  viewerUserId: string;
  viewerOrganizationId: string;
  organizations: Business[];
};

const PASSWORD_ALPHABET =
  "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(): string {
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

function roleLabel(role: string): string {
  return role === "owner" ? "Propietario" : "Miembro";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Negocios de la instancia: alta de clientes y panel de cada negocio.
 *
 * Solo se monta para quien opera la instancia (el owner de la organización más
 * antigua): el listado lee todas las organizaciones, algo que un cliente no debe
 * ver. Los demás owners siguen usando «Equipo» para su propio negocio.
 */
export function ClientBusinessesCard() {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string; business: string } | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/clients").catch(() => null);
    if (!res?.ok) {
      // Sin esto el listado quedaba vacío y se leía como «no hay negocios»,
      // cuando en realidad la API falló.
      setError("No se pudo leer la lista de negocios.");
      return;
    }
    const data = (await res.json()) as ClientsResponse;
    setBusinesses(data.organizations);
    setViewerUserId(data.viewerUserId);
    setError(null);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    setDeletedNotice(null);
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
            proyectos y datos de inteligencia no se ven entre sí. Pulsa un negocio
            para cambiar la contraseña de sus cuentas o eliminarlo.
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
              <Button
                variant="outline"
                onClick={() => setTempPassword(generatePassword())}
              >
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

          {deletedNotice && (
            <div className="flex items-start gap-2 rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{deletedNotice}</p>
            </div>
          )}

          {businesses && businesses.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {businesses.length} negocio{businesses.length === 1 ? "" : "s"}
              </p>
              {businesses.map((b) => (
                <BusinessRow
                  key={b.id}
                  business={b}
                  viewerUserId={viewerUserId}
                  onDeleted={(notice) => {
                    setDeletedNotice(notice);
                    void refetch();
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BusinessRow({
  business,
  viewerUserId,
  onDeleted,
}: {
  business: Business;
  viewerUserId: string | null;
  onDeleted: (notice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(
    business.people.find((p) => p.role === "owner")?.userId ??
      business.people[0]?.userId ??
      ""
  );
  const [newPassword, setNewPassword] = useState("");
  const [resetResult, setResetResult] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const [deleteName, setDeleteName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedPerson =
    business.people.find((p) => p.userId === selectedUserId) ?? null;
  const isSelf = selectedPerson?.userId === viewerUserId;
  const deleteReady = deleteName === business.name && !deleting;

  async function resetPassword() {
    if (!selectedPerson) return;
    setResetting(true);
    setResetError(null);
    setResetResult(null);
    const res = await fetch("/api/settings/clients", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: business.id,
        userId: selectedPerson.userId,
        password: newPassword,
      }),
    }).catch(() => null);
    setResetting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setResetError(data?.error?.message ?? "No se pudo cambiar la contraseña");
      return;
    }
    const data = (await res.json().catch(() => null)) as { email?: string } | null;
    setResetResult({
      email: data?.email ?? selectedPerson.email,
      password: newPassword,
    });
    setNewPassword("");
  }

  async function deleteBusiness() {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch("/api/settings/clients", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: business.id,
        confirmName: deleteName,
      }),
    }).catch(() => null);
    setDeleting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setDeleteError(data?.error?.message ?? "No se pudo eliminar el negocio");
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      usersDeleted?: number;
    } | null;
    onDeleted(
      `Negocio «${business.name}» eliminado. También se borraron ${plural(
        data?.usersDeleted ?? 0,
        "cuenta sin otro negocio",
        "cuentas sin otro negocio"
      )}.`
    );
  }

  const protectedReason = business.isPrincipal
    ? "Es el negocio principal de la instancia."
    : !business.canDelete
      ? "Es el negocio con el que estás trabajando."
      : null;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={open}
        aria-controls={`business-${business.id}`}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {business.name}
            {business.isPrincipal && <Badge variant="secondary">Principal</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {plural(business.members, "cuenta", "cuentas")} ·{" "}
            {new Date(business.createdAt).toLocaleDateString("es-MX")}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div id={`business-${business.id}`} className="space-y-5 border-t px-4 py-4">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Cambiar contraseña</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Se cerrarán todas las sesiones abiertas de la cuenta. Entrega la
              nueva contraseña tú mismo; no se volverá a mostrar.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor={`business-user-${business.id}`}>Cuenta</Label>
              {business.people.length > 1 ? (
                <select
                  id={`business-user-${business.id}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  {business.people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name} · {p.email} · {roleLabel(p.role)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm">
                  {selectedPerson
                    ? `${selectedPerson.name} · ${selectedPerson.email}`
                    : "Este negocio no tiene cuentas visibles."}
                </p>
              )}
            </div>

            {isSelf && (
              <p className="text-xs text-amber-600">
                Es tu propia cuenta: al guardar se cerrará también esta sesión.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`business-password-${business.id}`}>
                Nueva contraseña
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`business-password-${business.id}`}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                />
                <Button
                  variant="outline"
                  onClick={() => setNewPassword(generatePassword())}
                >
                  Generar
                </Button>
              </div>
            </div>

            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            {resetResult && (
              <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
                <p className="font-medium">Contraseña actualizada ✓</p>
                <p className="mt-1 opacity-90">
                  Entrega estos datos ahora (no se volverán a mostrar):
                  <br />
                  <code>{resetResult.email}</code> · contraseña{" "}
                  <code>{resetResult.password}</code>
                </p>
              </div>
            )}

            <Button
              disabled={!selectedPerson || newPassword.length < 8 || resetting}
              onClick={() => void resetPassword()}
            >
              <KeyRound className="h-4 w-4" />
              {resetting ? "Guardando…" : "Cambiar contraseña"}
            </Button>
          </section>

          <section className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-danger-text" />
              <h3 className="text-sm font-medium text-danger-text">Eliminar negocio</h3>
            </div>

            {protectedReason ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {protectedReason} No se puede eliminar.
              </p>
            ) : (
              <>
                <div className="flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-3 text-xs text-danger-text">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">Esta acción no se puede deshacer.</p>
                    <p>
                      Se borrarán {plural(business.stats.contacts, "contacto", "contactos")},{" "}
                      {plural(business.stats.conversations, "conversación", "conversaciones")},{" "}
                      {plural(business.stats.quotes, "cotización", "cotizaciones")} y{" "}
                      {plural(business.stats.projects, "proyecto", "proyectos")}, además de{" "}
                      {plural(business.members, "cuenta", "cuentas")}. Las cuentas que
                      también pertenezcan a otro negocio solo pierden esta membresía.
                    </p>
                    <p>
                      No se cancelan cuentas de WhatsApp, Instagram, TikTok ni otros
                      servicios externos.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`business-confirm-${business.id}`}>
                    Escribe <span className="font-semibold">{business.name}</span> para confirmar
                  </Label>
                  <Input
                    id={`business-confirm-${business.id}`}
                    value={deleteName}
                    onChange={(e) => setDeleteName(e.target.value)}
                    placeholder={business.name}
                  />
                </div>
                {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
                <Button
                  variant="destructive"
                  disabled={!deleteReady}
                  onClick={() => void deleteBusiness()}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Eliminando…" : "Eliminar negocio permanentemente"}
                </Button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
