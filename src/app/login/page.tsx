import { LoginForm } from "@/components/LoginForm";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Only allow same-site relative redirects after login. */
function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const config = getConfig();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold">OpenVPN Panel</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Sign in to manage your VPN.</p>
        <LoginForm
          next={safeNext(next)}
          demoHint={config.mode === "demo" && config.adminPasswordHash === null}
        />
      </div>
    </main>
  );
}
