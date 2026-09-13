"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
type Contact = { id: string; name: string | null; phone: string | null };
export function ContactPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => { void fetch(`/api/contacts?q=${encodeURIComponent(query)}`, { signal: abort.signal }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((d) => { setContacts(d.contacts); setError(""); }).catch(() => { if (!abort.signal.aborted) setError("No se pudieron cargar los contactos"); }); }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query]);
  return <div className="space-y-2"><label className="text-sm font-medium" htmlFor="contact-search">Contacto asociado</label>
    <Input id="contact-search" placeholder="Buscar contacto por nombre o teléfono" value={query} onChange={(e) => setQuery(e.target.value)} />
    <select aria-label="Contacto asociado" className="w-full rounded border bg-background p-2 text-sm" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Sin contacto</option>
      {value && !contacts.some((c) => c.id === value) && <option value={value}>Contacto actual</option>}
      {contacts.map((c) => <option key={c.id} value={c.id}>{c.name ?? "Sin nombre"} · {c.phone ?? "Sin teléfono"}</option>)}
    </select>{error && <p role="alert">{error}</p>}
  </div>;
}
