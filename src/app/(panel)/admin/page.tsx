import { SyncButton } from '@/features/admin/sync-button';

export default function AdminHome() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">관리자</h1>
        <p className="mt-2 text-sm text-zinc-500">
          좌측/상단 메뉴에서 유저·서버·노드·로케이션을 관리하세요.
        </p>
      </div>
      <div>
        <h2 className="mb-1 text-sm font-medium">서브유저 스코프</h2>
        <SyncButton />
      </div>
    </div>
  );
}
