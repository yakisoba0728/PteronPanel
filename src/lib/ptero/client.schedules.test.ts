import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  listSchedules,
  createSchedule,
  executeSchedule,
  deleteSchedule,
  createTask,
  deleteTask,
} from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const schedAttrs = (over = {}) => ({
  id: 10,
  name: 'nightly',
  cron: {
    minute: '0',
    hour: '4',
    day_of_week: '*',
    day_of_month: '*',
    month: '*',
  },
  is_active: true,
  is_processing: false,
  only_when_online: false,
  last_run_at: null,
  next_run_at: null,
  relationships: {
    tasks: {
      object: 'list',
      data: [
        {
          object: 'schedule_task',
          attributes: {
            id: 1,
            sequence_id: 1,
            action: 'backup',
            payload: '',
            time_offset: 0,
            is_queued: false,
            continue_on_failure: false,
          },
        },
      ],
    },
  },
  ...over,
});

describe('client schedules', () => {
  it('listSchedules maps with embedded tasks', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/schedules`, () =>
        HttpResponse.json({
          object: 'list',
          data: [{ object: 'server_schedule', attributes: schedAttrs() }],
        }),
      ),
    );
    const s = await listSchedules(id);
    expect(s[0]).toMatchObject({ id: 10, name: 'nightly', is_active: true });
    expect(s[0].tasks[0]).toMatchObject({ action: 'backup', sequence_id: 1 });
  });

  it('createSchedule posts cron fields', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/schedules`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'server_schedule',
          attributes: schedAttrs({ id: 11 }),
        });
      }),
    );
    await createSchedule(id, {
      name: 'n',
      minute: '0',
      hour: '4',
      day_of_month: '*',
      month: '*',
      day_of_week: '*',
      is_active: true,
    });
    expect(body).toMatchObject({
      name: 'n',
      minute: '0',
      hour: '4',
      is_active: true,
    });
  });

  it('executeSchedule + deleteSchedule', async () => {
    let exec = false;
    let del = false;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/schedules/10/execute`, () => {
        exec = true;
        return new HttpResponse(null, { status: 202 });
      }),
      http.delete(`${BASE}/servers/1a2b3c4d/schedules/10`, () => {
        del = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await executeSchedule(id, 10);
    await deleteSchedule(id, 10);
    expect([exec, del]).toEqual([true, true]);
  });

  it('createTask + deleteTask', async () => {
    let body: unknown;
    let delTask = false;
    mswServer.use(
      http.post(
        `${BASE}/servers/1a2b3c4d/schedules/10/tasks`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({
            object: 'schedule_task',
            attributes: {
              id: 2,
              sequence_id: 2,
              action: 'command',
              payload: 'say hi',
              time_offset: 5,
              is_queued: false,
              continue_on_failure: false,
            },
          });
        },
      ),
      http.delete(`${BASE}/servers/1a2b3c4d/schedules/10/tasks/2`, () => {
        delTask = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await createTask(id, 10, {
      action: 'command',
      payload: 'say hi',
      time_offset: 5,
    });
    await deleteTask(id, 10, 2);
    expect(body).toMatchObject({
      action: 'command',
      payload: 'say hi',
      time_offset: 5,
    });
    expect(delTask).toBe(true);
  });
});
