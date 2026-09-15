"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Plus,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewPaymentDialog } from "./new-payment-dialog";
import { NewExpenseDialog } from "./new-expense-dialog";
import { NewReceivable } from "./new-receivable";
import { PdfActions } from "@/components/pdf-actions";
import { Input } from "@/components/ui/input";

interface Balance {
  ingresos: number;
  egresos: number;
  balance: number;
  periodo: string;
}

interface CuentaPorCobrar {
  id: string;
  concept: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
}

interface Pago {
  id: string;
  monto: number;
  metodo: string;
  referencia: string | null;
  fecha: string;
}

interface Gasto {
  id: string;
  descripcion: string;
  categoria: string;
  monto: number;
  metodo: string;
  fecha: string;
}

interface BalanceData {
  balance: Balance;
  cuentasPorCobrar: CuentaPorCobrar[];
  pagosRecientes: Pago[];
  gastosRecientes: Gasto[];
}

function formatCurrency(amount: number): string {
  return `$${(amount / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function BalanceClient() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [showReceivable, setShowReceivable] = useState(false);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [to, setTo] = useState(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).toISOString().slice(0, 10));
  const [period, setPeriod] = useState("");
  const [error, setError] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/finances/balance?${period}`).catch(() => null);
    if (!res?.ok) { setError((await res?.json())?.error?.message ?? "No se pudo cargar el balance"); return; }
    setError("");
    const json = (await res.json()) as BalanceData;
    setData(json);
  }, [period]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function markAsPaid(cuenta: CuentaPorCobrar) {
    const remaining = cuenta.totalAmount - cuenta.paidAmount;
    if (remaining <= 0) return;
    setPayingId(cuenta.id);
    try {
      const res = await fetch("/api/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeId: cuenta.id,
          monto: remaining,
          metodo: "completo",
          notas: "Marcado como pagado desde Balance",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err?.error?.message ?? "No se pudo marcar como pagado");
        return;
      }
      void refetch();
    } catch {
      setError("Error de conexión");
    } finally {
      setPayingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Balance General</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowReceivable(true)}>Nueva cuenta por cobrar</Button>
          <Button size="sm" onClick={() => setShowPaymentDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Registrar Pago
          </Button>
          <Button size="sm" onClick={() => setShowExpenseDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Registrar Gasto
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label>Desde<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Hasta<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button disabled={!from || !to || from > to} onClick={() => setPeriod(new URLSearchParams({ from, to }).toString())}>Aplicar periodo</Button>
          <PdfActions url={`/api/finances/balance?format=pdf&${period}`} filename="Balance-LUMARK.pdf" />
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {showReceivable && <NewReceivable onClose={() => setShowReceivable(false)} onSaved={() => { setShowReceivable(false); void refetch(); }} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                Ingresos del periodo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-success-text">
                {formatCurrency(data?.balance.ingresos ?? 0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <TrendingDown className="h-4 w-4" />
                Egresos del periodo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-danger-text">
                {formatCurrency(data?.balance.egresos ?? 0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${(data?.balance.balance ?? 0) >= 0 ? "text-success-text" : "text-danger-text"}`}>
                {formatCurrency(data?.balance.balance ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold">Cuentas por cobrar</h3>
          {(data?.cuentasPorCobrar ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay cuentas pendientes.</p>
          ) : (
            <div className="space-y-2">
              {data?.cuentasPorCobrar.map((cuenta) => (
                <div
                  key={cuenta.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-[60%] flex-1 sm:min-w-0">
                    <span className="text-sm font-medium">{cuenta.concept}</span>
                    <p className="text-xs text-muted-foreground">
                      Total: {formatCurrency(cuenta.totalAmount)} · Pagado: {formatCurrency(cuenta.paidAmount)} · Pendiente: {formatCurrency(cuenta.totalAmount - cuenta.paidAmount)}
                    </p>
                  </div>
                  <Badge variant={cuenta.status === "pagado" ? "success" : "warning"}>
                    {cuenta.status === "pagado" ? "Pagado" : "Pendiente"}
                  </Badge>
                  {cuenta.status !== "pagado" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={payingId === cuenta.id}
                      onClick={() => void markAsPaid(cuenta)}
                    >
                      <CheckCircle className="mr-1 h-3.5 w-3.5" />
                      {payingId === cuenta.id ? "Procesando…" : "Marcar pagado"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold">Pagos recientes</h3>
          {(data?.pagosRecientes ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay pagos registrados.</p>
          ) : (
            <div className="space-y-2">
              {data?.pagosRecientes.map((pago) => (
                <div
                  key={pago.id}
                  className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-[60%] flex-1 sm:min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {formatDate(pago.fecha)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-success-text">
                    {formatCurrency(pago.monto)}
                  </span>
                  <span className="text-xs text-muted-foreground">{pago.metodo}</span>
                  {pago.referencia && (
                    <span className="text-xs text-muted-foreground">{pago.referencia}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold">Gastos recientes</h3>
          {(data?.gastosRecientes ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay gastos registrados.</p>
          ) : (
            <div className="space-y-2">
              {data?.gastosRecientes.map((gasto) => (
                <div
                  key={gasto.id}
                  className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-[60%] flex-1 sm:min-w-0">
                    <span className="text-sm font-medium">{gasto.descripcion}</span>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(gasto.fecha)} · {gasto.categoria}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-danger-text">
                    {formatCurrency(gasto.monto)}
                  </span>
                  <span className="text-xs text-muted-foreground">{gasto.metodo}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showPaymentDialog && (
        <NewPaymentDialog
          onClose={() => setShowPaymentDialog(false)}
          onSaved={() => {
            setShowPaymentDialog(false);
            void refetch();
          }}
        />
      )}

      {showExpenseDialog && (
        <NewExpenseDialog
          onClose={() => setShowExpenseDialog(false)}
          onSaved={() => {
            setShowExpenseDialog(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
