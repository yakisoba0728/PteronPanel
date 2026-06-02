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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const { pathname } = url;

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
