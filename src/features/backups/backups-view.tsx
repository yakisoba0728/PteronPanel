'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { BackupEntry } from '@/lib/ptero/types';
import {
  backupDownloadUrlAction,
  createBackupAction,
  deleteBackupAction,
  listBackupsAction,
  restoreBackupAction,
  toggleBackupLockAction,
} from '@/server/backups';

export function BackupsView({ identifier }: { identifier: string }) {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await listBackupsAction(identifier);
      if (res.ok) {
        setBackups(res.backups);
      } else {
        setMessage(
          res.error === 'not_found'
            ? '서버를 찾을 수 없습니다.'
            : (res.detail ?? '불러오기 실패'),
        );
      }
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  async function create() {
    const name = prompt('백업 이름(선택)') ?? undefined;
    const res = await createBackupAction(identifier, name || undefined);
    if (res.ok) load();
    else alert(res.detail ?? '생성 실패');
  }

  async function download(backup: BackupEntry) {
    const res = await backupDownloadUrlAction(identifier, backup.uuid);
    if (res.ok) window.open(res.url, '_blank', 'noopener,noreferrer');
    else alert(res.detail ?? '다운로드 실패');
  }

  async function restore(backup: BackupEntry) {
    if (!confirm(`${backup.name} 복원? 기존 파일을 덮어쓸 수 있습니다.`)) {
      return;
    }

    const res = await restoreBackupAction(identifier, backup.uuid, false);
    alert(res.ok ? '복원을 시작했습니다.' : (res.detail ?? '복원 실패'));
  }

  async function remove(backup: BackupEntry) {
    if (backup.is_locked) {
      alert('잠긴 백업은 삭제할 수 없습니다.');
      return;
    }
    if (!confirm(`${backup.name} 삭제?`)) return;

    const res = await deleteBackupAction(identifier, backup.uuid);
    if (res.ok) load();
    else alert(res.detail ?? '삭제 실패');
  }

  async function toggleLock(backup: BackupEntry) {
    const res = await toggleBackupLockAction(identifier, backup.uuid);
    if (res.ok) load();
    else alert(res.detail ?? '잠금 변경 실패');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">백업</h2>
        <Button type="button" onClick={create}>
          백업 생성
        </Button>
      </div>

      {message && <p className="text-sm text-red-600">{message}</p>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-2">이름</th>
              <th className="px-4 py-2">크기</th>
              <th className="px-4 py-2">상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr
                key={backup.uuid}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">
                  {backup.is_locked ? '[잠김] ' : ''}
                  {backup.name}
                </td>
                <td className="px-4 py-2 text-zinc-500">
                  {(backup.bytes / 1048576).toFixed(1)} MB
                </td>
                <td className="px-4 py-2">
                  {backup.is_successful ? '완료' : '진행/실패'}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => download(backup)}
                      disabled={!backup.is_successful}
                    >
                      다운로드
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => restore(backup)}
                      disabled={!backup.is_successful}
                    >
                      복원
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => toggleLock(backup)}
                    >
                      {backup.is_locked ? '잠금해제' : '잠금'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => remove(backup)}
                    >
                      삭제
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {pending && <p className="text-xs text-zinc-400">불러오는 중...</p>}
    </div>
  );
}
