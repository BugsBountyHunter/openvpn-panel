import { formatDateTime } from "@/lib/format";
import type { PkiItem, PkiWarning } from "@/lib/pki";

const WHAT: Record<PkiItem, string> = {
  server: "The server certificate",
  ca: "The CA certificate",
  crl: "The certificate revocation list (CRL)",
};

const IMPACT: Record<PkiItem, string> = {
  server: "Clients cannot connect once it expires.",
  ca: "Every certificate signed by it stops working. openvpn-install cannot renew a CA in place, so plan a new PKI.",
  crl: "OpenVPN rejects every client once it expires.",
};

const FIX: Record<PkiItem, string | null> = {
  server: "sudo openvpn-install.sh server renew",
  ca: null,
  crl: "cd /etc/openvpn/server/easy-rsa && sudo EASYRSA_CRL_DAYS=5475 ./easyrsa gen-crl && sudo install -m 644 pki/crl.pem /etc/openvpn/server/crl.pem",
};

function when(w: PkiWarning): string {
  if (w.expired) return w.daysLeft <= -1 ? `expired ${-w.daysLeft} day${w.daysLeft === -1 ? "" : "s"} ago` : "has expired";
  if (w.daysLeft === 0) return "expires today";
  return `expires in ${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"}`;
}

export function PkiWarnings({ warnings }: { warnings: PkiWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w) => {
        const tone = w.severity === "danger" ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn";
        const fix = FIX[w.item];
        return (
          <div key={w.item} role="alert" className={`rounded-lg border border-border px-4 py-2 text-sm ${tone}`}>
            <p>
              <strong>{WHAT[w.item]} {when(w)}</strong> ({formatDateTime(w.expiresAt)}). {IMPACT[w.item]}
            </p>
            {fix ? (
              <p className="mt-1 text-xs">
                Fix on the server: <code className="break-all">{fix}</code>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
