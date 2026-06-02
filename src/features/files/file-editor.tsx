'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { readFileAction, writeFileAction } from '@/server/files';

export function FileEditor({
  identifier,
  path,
}: {
  identifier: string;
  path: string;
}) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await readFileAction(identifier, path);
      if (res.ok) {
        setContent(res.content);
        setStatus('ready');
      } else {
        setStatus('error');
        setMessage(
          res.error === 'not_found' ? '찾을 수 없음' : (res.detail ?? '읽기 실패'),
        );
      }
    })();
  }, [identifier, path]);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await writeFileAction(identifier, path, content);
      setMessage(res.ok ? '저장됨' : (res.detail ?? '저장 실패'));
    });
  }

  if (status === 'loading') {
    return <p className="text-sm text-zinc-500">불러오는 중...</p>;
  }

  if (status === 'error') {
    return <p className="text-sm text-red-600">{message}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <code className="break-all text-sm text-zinc-500">{path}</code>
        <div className="flex items-center gap-3">
          {message && <span className="text-sm text-zinc-500">{message}</span>}
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            뒤로
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>
      <textarea
        className="h-[60vh] w-full rounded-md border border-zinc-300 bg-zinc-950 p-3 font-mono text-sm text-zinc-100 dark:border-zinc-700"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
