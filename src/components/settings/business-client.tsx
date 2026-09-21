"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BusinessSettings } from "@/lib/business-settings";

export function BusinessSettingsClient() {
  const [settings, setSettings] = useState<BusinessSettings>({
    companyName: "",
    rfc: "",
    address: "",
    phone: "",
    email: "",
    logoUrl: "",
    website: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/settings/business")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings: BusinessSettings } | null) => {
        if (d) setSettings(d.settings);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  function update<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/settings/business/logo", {
      method: "POST",
      body: form,
    }).catch(() => null);
    setUploading(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo subir el logo");
      return;
    }
    const data = (await res.json()) as { logoUrl: string };
    setSettings((prev) => ({ ...prev, logoUrl: data.logoUrl }));
    setSaved(true);
  }

  function removeLogo() {
    update("logoUrl", "");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/business", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    setSaved(true);
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de Empresa</CardTitle>
        <CardDescription>
          Información que aparece en el encabezado de las cotizaciones PDF. Deja
          en blanco los campos que no quieras mostrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo de la empresa</Label>
          <p className="text-xs text-muted-foreground">
            Si subes un logo, se mostrará en las cotizaciones. Si lo dejas vacío, se usa el nombre de la empresa como texto.
          </p>
          <div className="flex items-center gap-4">
            {settings.logoUrl ? (
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border-strong bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={settings.logoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
                <button
                  onClick={removeLogo}
                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  aria-label="Quitar logo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border-strong bg-secondary text-muted-foreground transition-colors hover:bg-accent">
                <Upload className="h-4 w-4" />
                <span className="mt-0.5 text-[10px]">Logo</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(e) => void handleLogoUpload(e)}
                />
              </label>
            )}
            {uploading && <span className="text-xs text-muted-foreground">Subiendo…</span>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bs-company">Nombre de la empresa</Label>
          <Input
            id="bs-company"
            maxLength={200}
            value={settings.companyName}
            onChange={(e) => update("companyName", e.target.value)}
            placeholder="Mi Empresa S.A. de C.V."
            className="max-w-md"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bs-rfc">RFC</Label>
            <Input
              id="bs-rfc"
              maxLength={20}
              value={settings.rfc}
              onChange={(e) => update("rfc", e.target.value)}
              placeholder="XAXX010101000"
              className="max-w-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-phone">Teléfono</Label>
            <Input
              id="bs-phone"
              maxLength={30}
              value={settings.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="55 1234 5678"
              className="max-w-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bs-email">Correo electrónico</Label>
            <Input
              id="bs-email"
              type="email"
              maxLength={254}
              value={settings.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="ventas@miempresa.com"
              className="max-w-md"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-website">Sitio web</Label>
            <Input
              id="bs-website"
              maxLength={254}
              value={settings.website}
              onChange={(e) => update("website", e.target.value)}
              placeholder="www.miempresa.com"
              className="max-w-md"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bs-address">Dirección fiscal</Label>
          <Input
            id="bs-address"
            maxLength={500}
            value={settings.address}
            onChange={(e) => update("address", e.target.value)}
            placeholder="Calle #123, Col. Centro, Ciudad, Estado, CP 00000"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">Datos guardados correctamente</p>}
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? "Guardando…" : "Guardar datos de empresa"}
        </Button>
      </CardContent>
    </Card>
  );
}
