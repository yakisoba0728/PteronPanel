import { pteroFetch } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type PowerSignal,
  type PteroItem,
  type PteroList,
  type ServerIdentifier,
  type ServerResources,
  type WebsocketCredentials,
} from './types';

export type ClientListType = 'admin-all' | 'owner' | undefined;

interface ClientServerAttrs {
  identifier: string;
  internal_id?: number;
  uuid: string;
  name: string;
  node?: string;
}

function toAccessible(attrs: ClientServerAttrs): AccessibleServer {
  return {
    identifier: asIdentifier(attrs.identifier),
    uuid: asUuid(attrs.uuid),
    numericId:
      attrs.internal_id !== undefined ? asNumericId(attrs.internal_id) : undefined,
    name: attrs.name,
    node: attrs.node,
  };
}

export async function listServers(
  type: ClientListType = undefined
): Promise<AccessibleServer[]> {
  const first = await pteroFetch<PteroList<ClientServerAttrs>>('client', '/', {
    query: { type, per_page: 100, page: 1 },
  });
  const data = [...first.data];
  const totalPages = first.meta.pagination.total_pages;

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await pteroFetch<PteroList<ClientServerAttrs>>('client', '/', {
      query: { type, per_page: 100, page },
    });
    data.push(...next.data);
  }

  return data.map((server) => toAccessible(server.attributes));
}

interface StatsEnvelope {
  attributes: {
    current_state: string;
    is_suspended: boolean;
    resources: {
      memory_bytes: number;
      cpu_absolute: number;
      disk_bytes: number;
      network_rx_bytes: number;
      network_tx_bytes: number;
      uptime: number;
    };
  };
}

export async function getResources(id: ServerIdentifier): Promise<ServerResources> {
  const response = await pteroFetch<StatsEnvelope>(
    'client',
    `/servers/${id}/resources`
  );

  return {
    current_state: response.attributes.current_state,
    is_suspended: response.attributes.is_suspended,
    ...response.attributes.resources,
  };
}

export async function getServer(
  id: ServerIdentifier
): Promise<PteroItem<ClientServerAttrs & Record<string, unknown>>> {
  return pteroFetch('client', `/servers/${id}`);
}

export async function powerServer(
  id: ServerIdentifier,
  signal: PowerSignal
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/power`, {
    method: 'POST',
    body: { signal },
  });
}

export async function sendCommand(
  id: ServerIdentifier,
  command: string
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/command`, {
    method: 'POST',
    body: { command },
  });
}

export async function getWebsocketCredentials(
  id: ServerIdentifier
): Promise<WebsocketCredentials> {
  const response = await pteroFetch<{ data: WebsocketCredentials }>(
    'client',
    `/servers/${id}/websocket`
  );

  return response.data;
}
