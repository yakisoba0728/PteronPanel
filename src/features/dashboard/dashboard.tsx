import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { getDashboardAction } from '@/server/dashboard';

export async function Dashboard() {
  const res = await getDashboardAction();

  if (!res.ok) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-red-600 dark:text-red-400">
          대시보드를 불러오지 못했습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">안녕하세요, {res.username}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          접근 가능한 서버와 주요 관리 메뉴를 확인하세요.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <div className="text-sm text-zinc-500">접근 가능한 서버</div>
          <div className="mt-2 text-3xl font-semibold">{res.totalServers}</div>
        </Card>

        {res.isAdmin && (
          <Link href="/admin">
            <Card className="h-full transition-colors hover:border-indigo-400">
              <div className="font-medium">관리자</div>
              <div className="mt-2 text-sm text-zinc-500">
                유저, 서버, 노드, 로케이션을 관리합니다.
              </div>
            </Card>
          </Link>
        )}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">최근 서버</h2>
          <Link
            href="/servers"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            전체 보기
          </Link>
        </div>
        {res.servers.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500">접근 가능한 서버가 없습니다.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {res.servers.map((server) => (
              <Link key={server.identifier} href={`/servers/${server.identifier}`}>
                <Card className="h-full transition-colors hover:border-indigo-400">
                  <div className="font-medium">{server.name}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {server.node ?? server.identifier}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
