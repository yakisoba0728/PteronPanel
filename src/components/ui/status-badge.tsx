import { Badge } from './badge';

const colors: Record<string, string> = {
  running: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  starting: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  stopping: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  offline: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export function StatusBadge({ state }: { state: string }) {
  return <Badge className={colors[state] ?? colors.offline}>{state}</Badge>;
}
