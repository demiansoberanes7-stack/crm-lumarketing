"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Punto de aterrizaje de una cuenta que aún no tiene negocio.
 *
 * Se llega aquí desde el registro (con SMTP, porque el alta no abre sesión y el
 * nombre del negocio no se pudo crear en ese viaje) o desde el shell de la app,
 * que redirige a esta pantalla en lugar de devolver al usuario a /login en un
 * bucle sin salida.
 */
export default function CreateBusinessPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(
        res?.status === 401
          ? "Tu sesión expiró. Inicia sesión para continuar."
          : (data?.error?.message ?? "No se pudo crear el negocio")
      );
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>¿Cómo se llama tu negocio?</CardTitle>
        <CardDescription>
          Con el nombre se crea tu espacio de trabajo: pipeline, catálogo de
          canales y motivos de pérdida, y el perfil del agente. Lo que registres
          aquí no se mezcla con el de ningún otro negocio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input
              id="business-name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
              placeholder="Peluquería Aurora"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || name.trim().length < 2}>
            {loading ? "Creando…" : "Crear mi negocio"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ¿No es tu cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
