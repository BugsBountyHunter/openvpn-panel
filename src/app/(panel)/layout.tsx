import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLinks } from "@/components/NavLinks";
import { Badge } from "@/components/ui";
import { sessionFromHeaders } from "@/lib/auth/request";
import { getConfig } from "@/lib/config";

export default async function PanelLayout({ children }: LayoutProps<"/">) {
  // The proxy already enforces this; checked again here as defence in depth.
  const session = sessionFromHeaders(await headers());
  if (!session) redirect("/login");
  const { mode } = getConfig();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">OpenVPN Panel</span>
            {mode === "demo" ? <Badge tone="warn">demo mode</Badge> : null}
          </div>
          <NavLinks />
          <div className="ml-auto flex items-center gap-2 text-sm text-muted">
            <span className="hidden sm:inline">{session.sub}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
