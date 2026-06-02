import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { PowerControls } from '@/features/server-overview/power-controls';
import { ServerAccessDeniedError } from '@/lib/authz/guard';
import { getServerOverview } from '@/server/servers';

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let attributes: Record<string, unknown>;
  try {
    ({ attributes } = await getServerOverview(id));
  } catch (error) {
    if (error instanceof ServerAccessDeniedError) notFound();
    throw error;
  }
  const limits = (attributes.limits ?? {}) as Record<string, number>;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-medium">전원</h2>
        <PowerControls identifier={id} />
        <p className="mt-2 text-xs text-zinc-500">
          실시간 상태·통계는 콘솔 탭에서 확인하세요.
        </p>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">리소스 제한</h2>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-zinc-500">메모리</dt>
            <dd>{limits.memory ?? '-'} MB</dd>
          </div>
          <div>
            <dt className="text-zinc-500">디스크</dt>
            <dd>{limits.disk ?? '-'} MB</dd>
          </div>
          <div>
            <dt className="text-zinc-500">CPU</dt>
            <dd>{limits.cpu ?? '-'} %</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
