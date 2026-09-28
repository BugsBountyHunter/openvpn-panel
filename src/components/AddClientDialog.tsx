"use client";

import { useState, type FormEvent } from "react";
import { isValidPassphrase, PASSPHRASE_MAX, PASSPHRASE_MIN } from "@/lib/client-options";
import { CLIENT_NAME_PATTERN, isServerCn } from "@/lib/names";
import type { AddOptions } from "@/lib/types";
import { CertDaysInput, parseCertDaysInput } from "./CertDaysInput";
import { Button, Modal } from "./Modal";

interface AddClientDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  /** Resolves true when the client was created, so the form can reset. */
  onAdd: (name: string, options: AddOptions) => Promise<boolean>;
}

const INPUT = "mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export function AddClientDialog({ open, busy, error, onClose, onAdd }: AddClientDialogProps) {
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [protect, setProtect] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");

  const nameValid = CLIENT_NAME_PATTERN.test(name) && !isServerCn(name);
  const certDays = parseCertDaysInput(days);
  const passphraseValid = !protect || isValidPassphrase(passphrase);
  const passphraseMatches = !protect || passphrase === confirm;
  const canSubmit = nameValid && certDays.valid && passphraseValid && passphraseMatches && !busy;

  function reset() {
    setName("");
    setDays("");
    setProtect(false);
    setPassphrase("");
    setConfirm("");
  }

  function close() {
    // Never keep a typed passphrase around after the dialog closes.
    setPassphrase("");
    setConfirm("");
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const created = await onAdd(name, {
      certDays: certDays.days,
      passphrase: protect ? passphrase : undefined,
    });
    if (created) reset();
  }

  return (
    <Modal open={open} title="Add client" onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="client-name" className="text-sm font-medium">Client name</label>
          <input
            id="client-name"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            className={INPUT}
            placeholder="e.g. alice-laptop"
          />
          <p className="mt-1.5 text-xs text-muted">
            1–32 characters: letters, digits, <code>-</code> and <code>_</code>. The .ovpn profile downloads once
            and is never stored by the panel — keep it safe.
          </p>
        </div>

        <CertDaysInput id="add-days" value={days} onChange={setDays} />

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
            Protect the private key with a passphrase
          </label>
          {protect ? (
            <>
              <div>
                <label htmlFor="add-passphrase" className="text-sm font-medium">Passphrase</label>
                <input
                  id="add-passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  maxLength={PASSPHRASE_MAX}
                  aria-invalid={passphrase !== "" && !passphraseValid}
                  className={INPUT}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {PASSPHRASE_MIN}–{PASSPHRASE_MAX} characters. The user types it on every connect. It is not stored
                  or logged, and cannot be recovered.
                </p>
              </div>
              <div>
                <label htmlFor="add-passphrase-confirm" className="text-sm font-medium">Confirm passphrase</label>
                <input
                  id="add-passphrase-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  maxLength={PASSPHRASE_MAX}
                  aria-invalid={confirm !== "" && !passphraseMatches}
                  className={INPUT}
                />
                {confirm !== "" && !passphraseMatches ? (
                  <p className="mt-1.5 text-xs text-danger">Passphrases do not match.</p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {error && open ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {busy ? "Creating…" : "Create & download"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
