'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  reinstallServerAction,
  renameServerAction,
  setDockerImageAction,
} from '@/server/settings';

export function SettingsView({
  identifier,
  currentName,
}: {
  identifier: string;
  currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const [image, setImage] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function rename() {
    const res = await renameServerAction(identifier, name);
    setMessage(res.ok ? '이름 변경됨' : (res.detail ?? '실패'));
  }

  async function reinstall() {
    if (!confirm('재설치하면 서버 파일이 초기화될 수 있습니다. 계속할까요?')) {
      return;
    }

    const res = await reinstallServerAction(identifier);
    setMessage(res.ok ? '재설치를 시작했습니다.' : (res.detail ?? '실패'));
  }

  async function changeImage() {
    if (!image) return;

    const res = await setDockerImageAction(identifier, image);
    setMessage(res.ok ? '이미지 변경됨' : (res.detail ?? '실패'));
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">설정</h2>

      {message && <p className="text-sm text-zinc-500">{message}</p>}

      <Card className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="text-zinc-500">서버 이름</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <Button type="button" onClick={rename}>
          변경
        </Button>
      </Card>

      <Card className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="text-zinc-500">Docker 이미지</span>
          <Input
            placeholder="새 이미지"
            value={image}
            onChange={(event) => setImage(event.target.value)}
          />
        </label>
        <Button type="button" onClick={changeImage}>
          변경
        </Button>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-medium text-red-600">위험 구역</h3>
        <Button type="button" variant="danger" onClick={reinstall}>
          서버 재설치
        </Button>
      </Card>
    </div>
  );
}
