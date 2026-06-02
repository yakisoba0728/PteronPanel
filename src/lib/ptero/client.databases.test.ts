import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  createDatabase,
  deleteDatabase,
  listDatabases,
  rotateDatabasePassword,
} from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const dbObj = (over = {}) => ({
  object: 'server_database',
  attributes: {
    id: 'HASH1',
    name: 's1_db',
    username: 'u_db',
    host: { address: '10.0.0.1', port: 3306 },
    connections_from: '%',
    max_connections: 0,
    relationships: {
      password: {
        object: 'database_password',
        attributes: { password: 'secret' },
      },
    },
    ...over,
  },
});

describe('client databases', () => {
  it('listDatabases maps + extracts password', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/databases`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('include')).toBe(
          'password',
        );
        return HttpResponse.json({ object: 'list', data: [dbObj()] });
      }),
    );
    const dbs = await listDatabases(id);
    expect(dbs[0]).toMatchObject({
      id: 'HASH1',
      name: 's1_db',
      host: { address: '10.0.0.1', port: 3306 },
      password: 'secret',
    });
  });

  it('createDatabase posts {database, remote}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/databases`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(dbObj({ id: 'HASH2' }));
      }),
    );
    const db = await createDatabase(id, { database: 'mydb', remote: '%' });
    expect(body).toEqual({ database: 'mydb', remote: '%' });
    expect(db.id).toBe('HASH2');
  });

  it('rotateDatabasePassword returns new password', async () => {
    mswServer.use(
      http.post(
        `${BASE}/servers/1a2b3c4d/databases/HASH1/rotate-password`,
        () =>
          HttpResponse.json(
            dbObj({
              relationships: {
                password: {
                  object: 'database_password',
                  attributes: { password: 'newsecret' },
                },
              },
            }),
          ),
      ),
    );
    expect((await rotateDatabasePassword(id, 'HASH1')).password).toBe(
      'newsecret',
    );
  });

  it('deleteDatabase DELETEs', async () => {
    let called = false;
    mswServer.use(
      http.delete(`${BASE}/servers/1a2b3c4d/databases/HASH1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteDatabase(id, 'HASH1');
    expect(called).toBe(true);
  });
});
