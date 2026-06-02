'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ServerSchedule } from '@/lib/ptero/types';
import {
  createScheduleAction,
  createTaskAction,
  deleteScheduleAction,
  deleteTaskAction,
  executeScheduleAction,
  listSchedulesAction,
  updateScheduleAction,
} from '@/server/schedules';

const emptyCron = {
  name: '',
  minute: '0',
  hour: '*',
  day_of_month: '*',
  month: '*',
  day_of_week: '*',
};

export function SchedulesView({ identifier }: { identifier: string }) {
  const [schedules, setSchedules] = useState<ServerSchedule[]>([]);
  const [form, setForm] = useState(emptyCron);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await listSchedulesAction(identifier);
      if (res.ok) {
        setSchedules(res.schedules);
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

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await createScheduleAction(identifier, {
      ...form,
      is_active: true,
    });
    if (res.ok) {
      setForm(emptyCron);
      load();
    } else {
      setMessage(
        res.detail ??
          (res.error === 'validation' ? '입력값을 확인하세요.' : '생성 실패'),
      );
    }
  }

  async function toggleActive(schedule: ServerSchedule) {
    const res = await updateScheduleAction(identifier, schedule.id, {
      name: schedule.name,
      minute: schedule.cron.minute,
      hour: schedule.cron.hour,
      day_of_month: schedule.cron.day_of_month,
      month: schedule.cron.month,
      day_of_week: schedule.cron.day_of_week,
      is_active: !schedule.is_active,
      only_when_online: schedule.only_when_online,
    });
    if (res.ok) load();
    else setMessage(res.detail ?? '상태 변경 실패');
  }

  async function execute(schedule: ServerSchedule) {
    const res = await executeScheduleAction(identifier, schedule.id);
    setMessage(res.ok ? '실행을 시작했습니다.' : (res.detail ?? '실패'));
  }

  async function remove(schedule: ServerSchedule) {
    if (!confirm(`${schedule.name} 삭제?`)) return;
    const res = await deleteScheduleAction(identifier, schedule.id);
    if (res.ok) load();
    else setMessage(res.detail ?? '삭제 실패');
  }

  async function addTask(schedule: ServerSchedule) {
    const payload = prompt('명령어 태스크 payload (예: say hi)');
    if (payload === null) return;
    const res = await createTaskAction(identifier, schedule.id, {
      action: 'command',
      payload,
      time_offset: 0,
    });
    if (res.ok) load();
    else setMessage(res.detail ?? '태스크 추가 실패');
  }

  async function removeTask(schedule: ServerSchedule, taskId: number) {
    const res = await deleteTaskAction(identifier, schedule.id, taskId);
    if (res.ok) load();
    else setMessage(res.detail ?? '태스크 삭제 실패');
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">스케줄</h2>
      {message && <p className="text-sm text-red-600">{message}</p>}

      <Card>
        <h3 className="mb-2 text-sm font-medium">새 스케줄</h3>
        <form onSubmit={create} className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          <Input
            placeholder="이름"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <Input
            placeholder="분"
            value={form.minute}
            onChange={(event) => setForm({ ...form, minute: event.target.value })}
          />
          <Input
            placeholder="시"
            value={form.hour}
            onChange={(event) => setForm({ ...form, hour: event.target.value })}
          />
          <Input
            placeholder="일"
            value={form.day_of_month}
            onChange={(event) =>
              setForm({ ...form, day_of_month: event.target.value })
            }
          />
          <Input
            placeholder="월"
            value={form.month}
            onChange={(event) => setForm({ ...form, month: event.target.value })}
          />
          <Input
            placeholder="요일"
            value={form.day_of_week}
            onChange={(event) =>
              setForm({ ...form, day_of_week: event.target.value })
            }
          />
          <Button type="submit">생성</Button>
        </form>
      </Card>

      {schedules.map((schedule) => (
        <Card key={schedule.id} className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{schedule.name}</span>
                <span className="text-xs text-zinc-500">
                  {schedule.is_active ? '활성' : '비활성'}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {schedule.cron.minute} {schedule.cron.hour}{' '}
                {schedule.cron.day_of_month} {schedule.cron.month}{' '}
                {schedule.cron.day_of_week}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => toggleActive(schedule)}
              >
                {schedule.is_active ? '비활성화' : '활성화'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => execute(schedule)}
              >
                지금 실행
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => addTask(schedule)}
              >
                태스크 추가
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => remove(schedule)}
              >
                삭제
              </Button>
            </div>
          </div>

          <ul className="space-y-1 text-sm">
            {[...schedule.tasks]
              .sort((a, b) => a.sequence_id - b.sequence_id)
              .map((task) => (
                <li
                  key={task.id}
                  className="flex flex-col gap-2 rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    #{task.sequence_id} {task.action}:{' '}
                    <code className="text-xs">{task.payload}</code> (+
                    {task.time_offset}s)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeTask(schedule, task.id)}
                  >
                    삭제
                  </Button>
                </li>
              ))}
          </ul>
        </Card>
      ))}

      {pending && <p className="text-xs text-zinc-400">불러오는 중...</p>}
    </div>
  );
}
