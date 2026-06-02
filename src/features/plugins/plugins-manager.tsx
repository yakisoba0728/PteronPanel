'use client';

import { Fragment, useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Deliveries } from '@/features/plugins/deliveries';
import {
  deletePluginAction,
  listPluginsAction,
  registerPluginAction,
  rotatePluginTokenAction,
  rotateWebhookSecretAction,
  setPluginEnabledAction,
  type PluginRow,
} from '@/server/plugins';

const EVENTS = [
  'server.power',
  'server.command',
  'backup.create',
  'backup.restore',
  'file.write',
  'file.delete',
  'server.create',
  'server.delete',
];

export function PluginsManager() {
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [form, setForm] = useState({
    name: '',
    description: '',
    webhookUrl: '',
    uiTabUrl: '',
    uiTabLabel: '',
  });
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [secret, setSecret] = useState<{
    token: string;
    webhookSecret: string;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openLogs, setOpenLogs] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const res = await listPluginsAction();
      if (res.ok) setPlugins(res.plugins);
      else setMsg(res.detail ?? '불러오기 실패');
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);

    const res = await registerPluginAction({
      name: form.name,
      description: form.description || undefined,
      webhookUrl: form.webhookUrl || undefined,
      uiTabUrl: form.uiTabUrl || undefined,
      uiTabLabel: form.uiTabLabel || undefined,
      events: [...events],
    });

    if (res.ok) {
      setSecret({ token: res.token, webhookSecret: res.webhookSecret });
      setForm({
        name: '',
        description: '',
        webhookUrl: '',
        uiTabUrl: '',
        uiTabLabel: '',
      });
      setEvents(new Set());
      load();
    } else {
      setMsg(res.detail ?? '등록 실패');
    }
  }

  async function toggle(plugin: PluginRow) {
    const res = await setPluginEnabledAction(plugin.id, !plugin.enabled);
    if (res.ok) load();
    else setMsg('변경 실패');
  }

  async function rotate(plugin: PluginRow) {
    const res = await rotatePluginTokenAction(plugin.id);
    if (res.ok) setSecret({ token: res.token, webhookSecret: '(unchanged)' });
    else setMsg('토큰 회전 실패');
  }

  async function rotateWebhookSecret(plugin: PluginRow) {
    const res = await rotateWebhookSecretAction(plugin.id);
    if (res.ok) setSecret({ token: '(unchanged)', webhookSecret: res.webhookSecret });
    else setMsg('webhook 시크릿 회전 실패');
  }

  async function remove(plugin: PluginRow) {
    if (!confirm(`${plugin.name} 삭제?`)) return;

    const res = await deletePluginAction(plugin.id);
    if (res.ok) load();
    else setMsg('삭제 실패');
  }

  function toggleEvent(event: string) {
    const next = new Set(events);
    if (next.has(event)) next.delete(event);
    else next.add(event);
    setEvents(next);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">플러그인</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {secret && (
        <Card className="border-amber-400">
          <p className="text-sm font-medium">
            이 값은 다시 표시되지 않습니다. 지금 보관하세요.
          </p>
          <p className="mt-2 break-all text-xs">
            토큰: <code>{secret.token}</code>
          </p>
          <p className="break-all text-xs">
            webhook 시크릿: <code>{secret.webhookSecret}</code>
          </p>
          <Button className="mt-3" variant="ghost" onClick={() => setSecret(null)}>
            닫기
          </Button>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-medium">새 플러그인</h2>
        <form onSubmit={register} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="이름"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Input
              placeholder="설명 (선택)"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
            <Input
              placeholder="webhook URL (선택)"
              value={form.webhookUrl}
              onChange={(event) =>
                setForm({ ...form, webhookUrl: event.target.value })
              }
            />
            <Input
              placeholder="UI 탭 URL (선택)"
              value={form.uiTabUrl}
              onChange={(event) =>
                setForm({ ...form, uiTabUrl: event.target.value })
              }
            />
            <Input
              placeholder="탭 라벨"
              value={form.uiTabLabel}
              onChange={(event) =>
                setForm({ ...form, uiTabLabel: event.target.value })
              }
            />
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={events.has(event)}
                  onChange={() => toggleEvent(event)}
                />
                {event}
              </label>
            ))}
          </div>

          <Button type="submit" disabled={pending}>
            등록
          </Button>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-2">이름</th>
              <th className="px-4 py-2">webhook</th>
              <th className="px-4 py-2">이벤트</th>
              <th className="px-4 py-2">상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plugins.map((plugin) => (
              <Fragment key={plugin.id}>
                <tr className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2">
                    <div className="font-medium">{plugin.name}</div>
                    {plugin.description && (
                      <div className="text-xs text-zinc-500">
                        {plugin.description}
                      </div>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-zinc-500">
                    {plugin.webhookUrl ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {plugin.events.length ? plugin.events.join(', ') : '-'}
                  </td>
                  <td className="px-4 py-2">
                    {plugin.enabled ? '활성' : '비활성'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setOpenLogs(openLogs === plugin.id ? null : plugin.id)
                        }
                      >
                        로그
                      </Button>
                      <Button variant="ghost" onClick={() => toggle(plugin)}>
                        {plugin.enabled ? '비활성' : '활성'}
                      </Button>
                      <Button variant="ghost" onClick={() => rotate(plugin)}>
                        토큰 회전
                      </Button>
                      {plugin.webhookUrl && (
                        <Button
                          variant="ghost"
                          onClick={() => rotateWebhookSecret(plugin)}
                        >
                          시크릿 회전
                        </Button>
                      )}
                      <Button variant="danger" onClick={() => remove(plugin)}>
                        삭제
                      </Button>
                    </div>
                  </td>
                </tr>
                {openLogs === plugin.id && (
                  <tr className="border-t border-zinc-100 dark:border-zinc-800">
                    <td colSpan={5} className="px-4 py-3">
                      <Deliveries pluginId={plugin.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {plugins.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-sm text-zinc-500" colSpan={5}>
                  등록된 플러그인이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
