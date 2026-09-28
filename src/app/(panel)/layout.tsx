import { NavLinks } from "@/components/NavLinks";
import { Badge } from "@/components/ui";
import { getConfig } from "@/lib/config";

export default function PanelLayout({ children }: LayoutProps<"/">) {
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
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
