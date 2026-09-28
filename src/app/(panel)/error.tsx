"use client";

interface PanelErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PanelError({ error, reset }: PanelErrorProps) {
  return (
    <div className="rounded-xl border border-border bg-danger-bg p-5 text-sm text-danger">
      <h2 className="font-semibold">Could not load data from the VPN server</h2>
      <p className="mt-1">
        Check that the helper and sudoers rule are installed (see server/install.sh) and look at the panel logs
        (<code>journalctl -u openvpn-panel</code>).
        {error.digest ? <> Reference: <code>{error.digest}</code></> : null}
      </p>
      <button type="button" onClick={reset} className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-text">
        Try again
      </button>
    </div>
  );
}
