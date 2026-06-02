'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { FileEntry } from '@/lib/ptero/types';
import {
  chmodAction,
  compressAction,
  copyAction,
  createFolderAction,
  decompressAction,
  deleteFilesAction,
  getDownloadUrlAction,
  getUploadUrlAction,
  listFilesAction,
  pullAction,
  renameAction,
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

  async function onRename(name: string) {
    const nextName = prompt('새 이름', name);
    if (!nextName || nextName === name) return;
    const res = await renameAction(identifier, dir, [{ from: name, to: nextName }]);
    if (res.ok) load(dir);
    else alert(res.detail ?? '이름 변경 실패');
  }

  async function onCopy(name: string) {
    const res = await copyAction(identifier, joinPath(dir, name));
    if (res.ok) load(dir);
    else alert(res.detail ?? '복사 실패');
  }

  async function onCompress(name: string) {
    const res = await compressAction(identifier, dir, [name]);
    if (res.ok) {
      alert(`압축 생성: ${res.archive.name}`);
      load(dir);
    } else {
      alert(res.detail ?? '압축 실패');
    }
  }

  async function onDecompress(name: string) {
    if (!confirm(`${name} 압축을 해제할까요?`)) return;
    const res = await decompressAction(identifier, dir, name);
    if (res.ok) load(dir);
    else alert(res.detail ?? '압축 해제 실패');
  }

  async function onChmod(name: string, currentMode: string) {
    const mode = prompt('권한 모드', currentMode || '0644');
    if (!mode) return;
    const res = await chmodAction(identifier, dir, [{ file: name, mode }]);
    if (res.ok) load(dir);
    else alert(res.detail ?? '권한 변경 실패');
  }

  async function onNewFolder() {
    const name = prompt('새 폴더 이름');
    if (!name) return;
    const res = await createFolderAction(identifier, dir, name);
    if (res.ok) load(dir);
    else alert(res.detail ?? '폴더 생성 실패');
  }

  async function onPull() {
    const url = prompt('원격 파일 URL');
    if (!url) return;
    const filename = prompt('저장 파일 이름(선택)') ?? '';
    const res = await pullAction(identifier, {
      url,
      directory: dir,
      filename: filename.trim() || undefined,
    });
    if (res.ok) load(dir);
    else alert(res.detail ?? '원격 풀 실패');
  }

  async function onDownload(name: string) {
    const res = await getDownloadUrlAction(identifier, joinPath(dir, name));
    if (res.ok) window.open(res.url, '_blank', 'noopener,noreferrer');
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
    const uploadRes = await fetch(uploadUrl(res.url, dir), {
      method: 'POST',
      body: form,
    });
    if (!uploadRes.ok) {
      alert('업로드 실패');
      return;
    }
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
            <span key={crumbs.slice(0, index + 1).join('/')}>
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
          <Button type="button" variant="secondary" onClick={onPull}>
            원격 풀
          </Button>
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
                  <div className="flex flex-wrap justify-end gap-2">
                    {entry.is_file && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onDownload(entry.name)}
                        >
                          다운로드
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onCopy(entry.name)}
                        >
                          복사
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onDecompress(entry.name)}
                        >
                          해제
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRename(entry.name)}
                    >
                      이름변경
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onCompress(entry.name)}
                    >
                      압축
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onChmod(entry.name, entry.mode_bits)}
                    >
                      권한
                    </Button>
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
