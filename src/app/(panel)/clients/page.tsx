import { AutoRefresh } from "@/components/AutoRefresh";
import { ClientsTable } from "@/components/ClientsTable";
import { Card } from "@/components/ui";
import { loadSnapshot } from "@/lib/panel";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const { clients, now } = await loadSnapshot();
  const online = clients.filter((c) => c.online).length;
  return (
    <div className="space-y-6">
      <AutoRefresh />
      <h1 className="text-xl font-semibold">Clients</h1>
      <Card title={`${clients.length} certificates · ${online} online`}>
        <ClientsTable clients={clients} now={now} />
      </Card>
    </div>
  );
}
