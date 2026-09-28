"use client";

import { CERT_DAYS_DEFAULT, CERT_DAYS_MAX, CERT_DAYS_MIN, isValidCertDays } from "@/lib/cert-days";

interface CertDaysInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/** Empty means "use the installer default". */
export function parseCertDaysInput(value: string): { valid: boolean; days: number | undefined } {
  if (value.trim() === "") return { valid: true, days: undefined };
  const days = Number(value);
  return isValidCertDays(days) ? { valid: true, days } : { valid: false, days: undefined };
}

export function CertDaysInput({ id, value, onChange }: CertDaysInputProps) {
  const { valid } = parseCertDaysInput(value);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">Certificate validity (days)</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={CERT_DAYS_MIN}
        max={CERT_DAYS_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={String(CERT_DAYS_DEFAULT)}
        aria-invalid={!valid}
        className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent aria-[invalid=true]:border-danger"
      />
      <p className="mt-1.5 text-xs text-muted">
        {CERT_DAYS_MIN}–{CERT_DAYS_MAX} days. Leave empty for the default ({CERT_DAYS_DEFAULT}).
      </p>
    </div>
  );
}
