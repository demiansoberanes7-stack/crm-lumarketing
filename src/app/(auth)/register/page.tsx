"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const { error: err, data } = await signUp.email({ name, email, password });
    if (err) {
      setLoading(false);
      if (err.status === 403) {
        setError(
          "El registro está cerrado en esta instancia. Pide acceso al propietario o una cuenta de cliente."
        );
      } else if (err.status === 429) {
        setError("Demasiados intentos. Espera unos minutos.");
      } else {
        setError(err.message ?? "No se pudo crear la cuenta.");
      }
      return;
    }
    // Con verificación de email activada (SMTP configurado) el alta no crea
    // sesión: el enlace de verificación llega por correo y el negocio se crea
    // al primer acceso, en /crear-negocio. Sin ella, `token` existe y se crea
    // ahora, en el mismo viaje.
    if (!data?.token) {
      setLoading(false);
      setInfo(
        "Cuenta creada. Revisa tu correo, confirma el enlace y al entrar nombras tu negocio."
      );
      return;
    }
    const res = await fetch("/api/auth/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: businessName }),
    }).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      // Autenticado pero sin negocio: aquí no se puede quedar (el shell exige
      // organización), así que se le lleva a la pantalla que lo completa.
      router.push("/crear-negocio");
      router.refresh();
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>
        Cada cuenta crea su propio negocio y sus datos quedan aislados del
        resto. Si el registro público está cerrado, el propietario de la
        instancia te da la cuenta de cliente.
      </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input
              id="business-name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
              placeholder="Peluquería Aurora"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creando…" : "Crear cuenta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
