import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { AccessibleServer } from '@/lib/ptero/types';

export function ServerCard({ server }: { server: AccessibleServer }) {
  return (
    <Link href={`/servers/${server.identifier}`}>
      <Card className="transition-colors hover:border-indigo-400">
        <div className="font-medium">{server.name}</div>
        <div className="mt-1 text-xs text-zinc-500">{server.node ?? server.identifier}</div>
      </Card>
    </Link>
  );
}
