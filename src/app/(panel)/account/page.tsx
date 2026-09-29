import { ChangePasswordForm, SignOutOthers } from "@/components/AccountForms";
import { Card } from "@/components/ui";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function AccountPage() {
  const { adminUser, authStatePath } = getConfig();
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Account</h1>
      <Card title={`Password for ${adminUser}`}>
        <ChangePasswordForm />
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          Stored as an argon2id hash in <code>{authStatePath}</code>. Forgot it? On the server, run{" "}
          <code>sudo bash install.sh --reset-password</code>; a password set there always takes precedence.
        </p>
      </Card>
      <Card title="Sessions">
        <SignOutOthers />
      </Card>
    </div>
  );
}
