'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { FileEntry } from '@/lib/ptero/types';
import {
  createFolderAction,
  deleteFilesAction,
  getDownloadUrlAction,
  getUploadUrlAction,
  listFilesAction,
} from '@/server/files';

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, '')}/${name}`;
}

function uploadUrl(url: string, directory: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}directory=${encodeURIComponent(directory)}`;
}

export function FileBrowser({ identifier }: { identifier: string }) {
  const [dir, setDir] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load(target: string) {
    setError(null);
    startTransition(async () => {
      const res = await listFilesAction(identifier, target);
      if (res.ok) {
        setEntries(res.entries);
        setDir(target);
      } else {
        setError(
          res.error === 'not_found'
            ? '서버를 찾을 수 없습니다.'
            : (res.detail ?? '불러오기 실패'),
        );
      }
    });
  }

  useEffect(() => {
    load('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  const crumbs = dir.split('/').filter(Boolean);

  async function onDelete(name: string) {
    if (!confirm(`${name} 삭제할까요?`)) return;
    const res = await deleteFilesAction(identifier, dir, [name]);
    if (res.ok) load(dir);
    else alert(res.detail ?? '삭제 실패');
  }

  async function onNewFolder() {
    const name = prompt('새 폴더 이름');
    if (!name) return;
    const res = await createFolderAction(identifier, dir, name);
    if (res.ok) load(dir);
    else alert(res.detail ?? '폴더 생성 실패');
  }

  async function onDownload(name: string) {
    const res = await getDownloadUrlAction(identifier, joinPath(dir, name));
    if (res.ok) window.open(res.url, '_blank');
    else alert(res.detail ?? '다운로드 URL 실패');
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const res = await getUploadUrlAction(identifier);
    if (!res.ok) {
      alert(res.detail ?? '업로드 URL 실패');
      return;
    }

    const form = new FormData();
    form.append('files', file);
    await fetch(uploadUrl(res.url, dir), { method: 'POST', body: form });
    e.target.value = '';
    load(dir);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">
          <button className="hover:underline" onClick={() => load('/')}>
            root
          </button>
          {crumbs.map((crumb, index) => (
            <span key={crumb}>
              {' / '}
              <button
                className="hover:underline"
                onClick={() => load(`/${crumbs.slice(0, index + 1).join('/')}`)}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onNewFolder}>
            새 폴더
          </Button>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-md bg-zinc-200 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100">
            업로드
            <input type="file" className="hidden" onChange={onUpload} />
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <tbody>
            {dir !== '/' && (
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <button
                    className="font-medium"
                    onClick={() => load(`/${crumbs.slice(0, -1).join('/')}`)}
                  >
                    ..
                  </button>
                </td>
                <td />
                <td />
              </tr>
            )}
            {entries.map((entry) => (
              <tr
                key={entry.name}
                className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
              >
                <td className="px-4 py-2">
                  {entry.is_file ? (
                    <Link
                      className="hover:underline"
                      href={`/servers/${identifier}/files/edit?path=${encodeURIComponent(
                        joinPath(dir, entry.name),
                      )}`}
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <button
                      className="font-medium hover:underline"
                      onClick={() => load(joinPath(dir, entry.name))}
                    >
                      {entry.name}/
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-zinc-500">
                  {entry.is_file ? `${entry.size} B` : ''}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {entry.is_file && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onDownload(entry.name)}
                      >
                        다운로드
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onDelete(entry.name)}
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
