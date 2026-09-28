"use client";

import { useState, type FormEvent } from "react";
import { CertDaysInput, parseCertDaysInput } from "./CertDaysInput";
import { Button, Modal } from "./Modal";

interface RenewDialogProps {
  /** Client to renew; null closes the dialog. */
  name: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRenew: (name: string, certDays: number | undefined) => void;
}

export function RenewDialog({ name, busy, error, onClose, onRenew }: RenewDialogProps) {
  const [days, setDays] = useState("");
  const parsed = parseCertDaysInput(days);

  function close() {
    setDays("");
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name && parsed.valid) onRenew(name, parsed.days);
  }

  return (
    <Modal open={name !== null} title="Renew certificate?" onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">
          A new certificate is issued for <strong className="text-text">{name}</strong> and the new profile downloads
          once. The <strong className="text-text">old profile stops working</strong>, so the user must import the new
          one.
        </p>
        <CertDaysInput id="renew-days" value={days} onChange={setDays} />
        {error && name ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!parsed.valid || busy}>
            {busy ? "Renewing…" : "Renew & download"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
