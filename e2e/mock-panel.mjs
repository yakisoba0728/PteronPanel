import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const OWNED = {
  object: 'server',
  attributes: {
    id: 12,
    identifier: '1a2b3c4d',
    uuid: '1a2b3c4d-0000-4000-8000-000000000000',
    name: 'User Server',
    node: 'Node 01',
  },
};

const OTHER = {
  object: 'server',
  attributes: {
    id: 13,
    identifier: '9z9z9z9z',
    uuid: '9a9a9a9a-0000-4000-8000-000000000000',
    name: 'Other Server',
    node: 'Node 02',
  },
};

const wsEvents = [];
const createdServers = [];

function list(data) {
  return {
    object: 'list',
    data,
    meta: {
      pagination: {
        total: data.length,
        count: data.length,
        per_page: 100,
        current_page: 1,
        total_pages: 1,
      },
    },
  };
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const { pathname } = url;
  const method = req.method;

  if (
    pathname === '/api/application/users' &&
    url.searchParams.get('filter[email]') === 'user@example.com'
  ) {
    return json(
      res,
      list([
        {
          object: 'user',
          attributes: { id: 7, uuid: 'u-7', email: 'user@example.com' },
        },
      ]),
    );
  }

  if (pathname === '/api/application/users') {
    return json(
      res,
      list([
        {
          object: 'user',
          attributes: {
            id: 7,
            uuid: 'u-7',
            username: 'user',
            email: 'user@example.com',
            first_name: 'U',
            last_name: 'Ser',
            root_admin: false,
            created_at: '',
          },
        },
      ]),
    );
  }

  if (pathname === '/api/application/users/7') {
    return json(res, {
      object: 'user',
      attributes: {
        id: 7,
        relationships: {
          servers: list([OWNED]),
        },
      },
    });
  }

  if (pathname === '/api/application/nodes') {
    return json(
      res,
      list([
        {
          object: 'node',
          attributes: {
            id: 1,
            name: 'node-01',
            fqdn: 'node01.example.com',
            memory: 16384,
            memory_overallocate: 0,
            disk: 500000,
            disk_overallocate: 0,
            location_id: 1,
            maintenance_mode: false,
          },
        },
      ]),
    );
  }

  if (pathname === '/api/application/locations') {
    return json(
      res,
      list([
        {
          object: 'location',
          attributes: { id: 1, short: 'kr', long: 'Korea' },
        },
      ]),
    );
  }

  if (pathname === '/api/application/nests') {
    return json(
      res,
      list([
        {
          object: 'nest',
          attributes: { id: 1, name: 'Minecraft', description: null },
        },
      ]),
    );
  }

  if (pathname === '/api/application/nests/1/eggs') {
    return json(
      res,
      list([
        {
          object: 'egg',
          attributes: {
            id: 5,
            name: 'Paper',
            docker_image: 'ghcr.io/pterodactyl/yolks:java_17',
            startup: 'java -jar server.jar',
          },
        },
      ]),
    );
  }

  if (pathname === '/api/application/nests/1/eggs/5') {
    return json(res, {
      object: 'egg',
      attributes: {
        id: 5,
        name: 'Paper',
        docker_image: 'ghcr.io/pterodactyl/yolks:java_17',
        startup: 'java -jar server.jar',
        relationships: {
          variables: {
            object: 'list',
            data: [
              {
                object: 'egg_variable',
                attributes: {
                  name: 'Version',
                  description: '',
                  env_variable: 'MC_VERSION',
                  default_value: 'latest',
                  rules: 'required|string',
                  user_editable: true,
                },
              },
            ],
          },
        },
      },
    });
  }

  if (pathname === '/api/application/servers' && method === 'POST') {
    const body = await readJson(req);
    const created = {
      object: 'server',
      attributes: {
        id: 99 + createdServers.length,
        uuid: `new-uuid-${createdServers.length}`,
        identifier: `newsrv${createdServers.length}`.slice(0, 8),
        name: body.name ?? 'E2E Server',
        user: body.user ?? 7,
        node: 1,
        allocation: 1,
        egg: body.egg ?? 5,
        docker_image: body.docker_image,
        startup: body.startup,
        suspended: false,
        limits: body.limits ?? {
          memory: 1024,
          swap: 0,
          disk: 5120,
          io: 500,
          cpu: 100,
        },
        feature_limits: body.feature_limits ?? {
          databases: 1,
          allocations: 1,
          backups: 1,
        },
      },
    };
    createdServers.push(created);
    return json(res, {
      object: 'server',
      attributes: created.attributes,
    });
  }

  if (pathname === '/api/application/servers') {
    return json(
      res,
      list([
        {
          object: 'server',
          attributes: {
            id: 12,
            uuid: 'u',
            identifier: '1a2b3c4d',
            name: 'User Server',
            user: 7,
            node: 1,
            suspended: false,
            limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 },
            feature_limits: { databases: 1, allocations: 1, backups: 1 },
          },
        },
        ...createdServers,
      ]),
    );
  }

  if (pathname === '/api/client' || pathname === '/api/client/') {
    if (url.searchParams.get('type') === 'admin-all') {
      return json(res, list([OWNED, OTHER]));
    }

    return json(res, list([OWNED]));
  }

  if (pathname === '/api/client/servers/1a2b3c4d') {
    return json(res, {
      object: 'server',
      attributes: {
        ...OWNED.attributes,
        limits: { memory: 1024, disk: 5120, cpu: 100 },
        feature_limits: { databases: 0, allocations: 0, backups: 0 },
      },
    });
  }

  if (pathname === '/api/client/servers/1a2b3c4d/power' && req.method === 'POST') {
    return json(res, {}, 204);
  }

  if (pathname === '/api/client/servers/1a2b3c4d/websocket') {
    return json(res, {
      data: {
        token: 'fake-jwt',
        socket: 'ws://127.0.0.1:9099/ws',
      },
    });
  }

  if (pathname === '/api/client/servers/1a2b3c4d/files/list') {
    return json(
      res,
      list([
        {
          object: 'file_object',
          attributes: {
            name: 'server.properties',
            mode: '-rw-r--r--',
            mode_bits: '0644',
            size: 20,
            is_file: true,
            is_symlink: false,
            mimetype: 'text/plain',
            created_at: '',
            modified_at: '',
          },
        },
      ]),
    );
  }

  if (pathname === '/api/client/servers/1a2b3c4d/backups') {
    return json(
      res,
      list([
        {
          object: 'backup',
          attributes: {
            uuid: 'bk-1',
            name: 'daily',
            bytes: 1048576,
            checksum: 'abc',
            is_locked: false,
            is_successful: true,
            created_at: '',
            completed_at: '',
          },
        },
      ]),
    );
  }

  if (pathname === '/api/client/servers/1a2b3c4d/schedules') {
    return json(
      res,
      list([
        {
          object: 'server_schedule',
          attributes: {
            id: 10,
            name: 'Nightly Backup',
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
          },
        },
      ]),
    );
  }

  if (pathname === '/api/client/servers/1a2b3c4d/databases') {
    return json(res, {
      object: 'list',
      data: [
        {
          object: 'server_database',
          attributes: {
            id: 'H1',
            name: 's1_default',
            username: 'u',
            host: { address: '10.0.0.1', port: 3306 },
            connections_from: '%',
            max_connections: 0,
          },
        },
      ],
    });
  }

  if (pathname === '/api/client/servers/1a2b3c4d/network/allocations') {
    return json(res, {
      object: 'list',
      data: [
        {
          object: 'allocation',
          attributes: {
            id: 1,
            ip: '0.0.0.0',
            ip_alias: null,
            port: 25565,
            notes: null,
            is_default: true,
          },
        },
      ],
    });
  }

  if (pathname === '/api/client/servers/1a2b3c4d/startup') {
    return json(res, {
      object: 'list',
      data: [
        {
          object: 'egg_variable',
          attributes: {
            name: 'Version',
            description: '',
            env_variable: 'MC_VERSION',
            default_value: 'latest',
            server_value: '1.20',
            is_editable: true,
            rules: 'required|string',
          },
        },
      ],
      meta: { startup_command: 'java' },
    });
  }

  if (pathname === '/api/client/servers/1a2b3c4d/activity') {
    return json(res, {
      object: 'list',
      data: [
        {
          object: 'activity_log',
          attributes: {
            id: 'a1',
            event: 'server:console.command',
            ip: '1.2.3.4',
            description: null,
            timestamp: '2026-01-01T00:00:00Z',
          },
        },
      ],
      meta: {
        pagination: {
          total: 1,
          count: 1,
          per_page: 50,
          current_page: 1,
          total_pages: 1,
        },
      },
    });
  }

  if (pathname === '/ws-events') {
    return json(res, { events: wsEvents });
  }

  return json(
    res,
    {
      errors: [
        {
          code: 'NotFoundHttpException',
          status: '404',
          detail: 'mock: not found',
        },
      ],
    },
    404,
  );
});

const wss = new WebSocketServer({ server, path: '/ws' });

function sendStats(ws) {
  ws.send(
    JSON.stringify({
      event: 'stats',
      args: [
        JSON.stringify({
          memory_bytes: 1048576,
          cpu_absolute: 2.5,
          disk_bytes: 2097152,
          network: { rx_bytes: 1, tx_bytes: 2 },
          uptime: 3,
          state: 'running',
        }),
      ],
    }),
  );
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    wsEvents.push(message);

    if (message.event === 'auth') {
      ws.send(JSON.stringify({ event: 'auth success', args: [] }));
      sendStats(ws);
    }

    if (message.event === 'send stats') {
      sendStats(ws);
    }
  });
});

server.listen(9099, () => {
  console.log('mock-panel on :9099');
});
