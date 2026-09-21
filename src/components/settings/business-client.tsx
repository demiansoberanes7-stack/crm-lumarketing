"use client";

import { useEffect, useState } from "react";
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
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
