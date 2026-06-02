import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

const { audit } = vi.hoisted(() => ({
  audit: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    role: 'ADMIN',
    pteroUserId: null,
  })),
}));

vi.mock('@/lib/audit', () => ({ audit }));

import {
  listSchedulesAction,
  createScheduleAction,
  updateScheduleAction,
  executeScheduleAction,
  deleteScheduleAction,
  createTaskAction,
  updateTaskAction,
  deleteTaskAction,
} from './schedules';

const CLIENT = 'https://panel.test/api/client';
const validSchedule = {
  name: 'nightly',
  minute: '0',
  hour: '4',
  day_of_month: '*',
  month: '*',
  day_of_week: '*',
};
const validTask = {
  action: 'command' as const,
  payload: 'say hi',
  time_offset: 0,
};

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

function adminLists(identifier: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [
          {
            object: 'server',
            attributes: {
              identifier,
              uuid: `${identifier}-0000-4000-8000-000000000000`,
              name: 'S',
            },
          },
        ],
        meta: {
          pagination: {
            total: 1,
            count: 1,
            per_page: 100,
            current_page: 1,
            total_pages: 1,
          },
        },
      }),
    ),
  );
}

describe('schedule actions', () => {
  it('lists for accessible server', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(
      http.get(`${CLIENT}/servers/1a2b3c4d/schedules`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server_schedule',
              attributes: {
                id: 10,
                name: 'n',
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
              },
            },
          ],
        }),
      ),
    );
    const res = await listSchedulesAction('1a2b3c4d');
    expect(res.ok && res.schedules[0].id).toBe(10);
  });

  it('returns not_found for inaccessible list', async () => {
    adminLists('1a2b3c4d');
    expect(await listSchedulesAction('deadbeef')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('guards mutation actions before validation or ptero calls', async () => {
    adminLists('1a2b3c4d');

    await expect(
      createScheduleAction('deadbeef', {
        name: '',
        minute: '',
        hour: '',
        day_of_month: '',
        month: '',
        day_of_week: '',
      }),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(
      updateScheduleAction('deadbeef', 10, validSchedule),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(executeScheduleAction('deadbeef', 10)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(deleteScheduleAction('deadbeef', 10)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(createTaskAction('deadbeef', 10, validTask)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(
      updateTaskAction('deadbeef', 10, 2, validTask),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(deleteTaskAction('deadbeef', 10, 2)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('createSchedule validates cron presence for accessible server', async () => {
    adminLists('1a2b3c4d');
    const res = await createScheduleAction('1a2b3c4d', {
      name: '',
      minute: '',
      hour: '',
      day_of_month: '',
      month: '',
      day_of_week: '',
    });
    expect(res.ok).toBe(false);
  });
});
