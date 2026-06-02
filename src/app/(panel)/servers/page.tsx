import { ServerCard } from '@/features/server-list/server-card';
import { listMyServers } from '@/server/servers';

export default async function ServersPage() {
  const servers = await listMyServers();

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">내 서버</h1>
      {servers.length === 0 ? (
        <p className="text-sm text-zinc-500">접근 가능한 서버가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <ServerCard key={server.identifier} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
