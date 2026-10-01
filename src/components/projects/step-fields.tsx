"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ContactPicker } from "@/components/contact-picker";
import { MemberPicker, type CrmMember } from "@/components/member-picker";
import type { ProjectFieldDef, ProjectStepDef } from "@/lib/project-types";

const selectClass = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

/** Renderiza los campos de un paso del stepper (genérico y por tipo). */
export function StepFields({
  step,
  values,
  onChange,
  disabled,
  errors,
  members,
}: {
  step: ProjectStepDef;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  members?: CrmMember[];
}) {
  return (
    <div className="space-y-4">
      {step.fields.map((field) => {
        const error = errors?.[field.key];
        return (
          <div key={field.key} className="space-y-1.5">
            {field.type !== "contact" && field.type !== "member" && field.type !== "checkbox" && (
              <Label htmlFor={`field-${step.key}-${field.key}`}>
                {field.label}
                {field.required && <span className="ml-0.5 text-danger-text">*</span>}
              </Label>
            )}
            <FieldControl
              field={field}
              stepKey={step.key}
              value={values[field.key]}
              onChange={(v) => onChange(field.key, v)}
              disabled={disabled}
              members={members}
            />
            {field.help && !error && (
              <p className="text-xs text-muted-foreground">{field.help}</p>
            )}
            {error && (
              <p role="alert" className="text-xs text-danger-text">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({
  field,
  stepKey,
  value,
  onChange,
  disabled,
  members,
}: {
  field: ProjectFieldDef;
  stepKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  members?: CrmMember[];
}) {
  const id = `field-${stepKey}-${field.key}`;
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          rows={4}
          value={text}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "currency":
      return (
        <div className="relative">
          {field.type === "currency" && (
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
          )}
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            className={field.type === "currency" ? "pl-6" : undefined}
            value={text}
            disabled={disabled}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value)}
          />
        </div>
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "select":
      return (
        <select
          id={id}
          className={selectClass}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Sin seleccionar</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid gap-2 rounded-md border border-input p-2.5 sm:grid-cols-2">
          {(field.options ?? []).map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((v) => v !== o.value)
                        : [...selected, o.value]
                    )
                  }
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={value === true || value === "true"}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.help ?? field.label}
        </label>
      );
    case "contact":
      return (
        <ContactPicker
          value={typeof value === "string" ? value : null}
          onChange={(v) => onChange(v)}
        />
      );
    case "member":
      return (
        <MemberPicker
          value={typeof value === "string" ? value : null}
          onChange={(v) => onChange(v)}
          members={members}
          disabled={disabled}
          label={field.label}
        />
      );
    default:
      return (
        <Input
          id={id}
          value={text}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
