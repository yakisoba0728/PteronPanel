import { pteroFetch, pteroFetchText } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type FileEntry,
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

  // Map each row defensively: a single malformed row (e.g. an invalid
  // identifier/uuid) must not throw away the entire list. Skip and warn.
  return data.flatMap((server) => {
    try {
      return [toAccessible(server.attributes)];
    } catch (error) {
      console.warn(
        `Skipping invalid server row (identifier=${server.attributes?.identifier}):`,
        error,
      );
      return [];
    }
  });
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

interface SignedUrl {
  attributes: { url: string };
}

export async function listFiles(
  id: ServerIdentifier,
  directory = '/',
): Promise<FileEntry[]> {
  const response = await pteroFetch<PteroList<FileEntry>>(
    'client',
    `/servers/${id}/files/list`,
    { query: { directory } },
  );

  return response.data.map((item) => item.attributes);
}

export function getFileContents(
  id: ServerIdentifier,
  file: string,
): Promise<string> {
  return pteroFetchText('client', `/servers/${id}/files/contents`, {
    query: { file },
  });
}

export async function writeFile(
  id: ServerIdentifier,
  file: string,
  content: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/write`, {
    method: 'POST',
    rawBody: content,
    contentType: 'text/plain',
    query: { file },
  });
}

export async function getFileDownloadUrl(
  id: ServerIdentifier,
  file: string,
): Promise<string> {
  const response = await pteroFetch<SignedUrl>(
    'client',
    `/servers/${id}/files/download`,
    { query: { file } },
  );

  return response.attributes.url;
}

export async function getFileUploadUrl(
  id: ServerIdentifier,
): Promise<string> {
  const response = await pteroFetch<SignedUrl>(
    'client',
    `/servers/${id}/files/upload`,
  );

  return response.attributes.url;
}

export async function renameFiles(
  id: ServerIdentifier,
  root: string,
  files: Array<{ from: string; to: string }>,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/rename`, {
    method: 'PUT',
    body: { root, files },
  });
}

export async function copyFile(
  id: ServerIdentifier,
  location: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/copy`, {
    method: 'POST',
    body: { location },
  });
}

export async function compressFiles(
  id: ServerIdentifier,
  root: string,
  files: string[],
): Promise<FileEntry> {
  const response = await pteroFetch<{ attributes: FileEntry }>(
    'client',
    `/servers/${id}/files/compress`,
    { method: 'POST', body: { root, files } },
  );

  return response.attributes;
}

export async function decompressFile(
  id: ServerIdentifier,
  root: string,
  file: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/decompress`, {
    method: 'POST',
    body: { root, file },
  });
}

export async function deleteFiles(
  id: ServerIdentifier,
  root: string,
  files: string[],
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/delete`, {
    method: 'POST',
    body: { root, files },
  });
}

export async function createFolder(
  id: ServerIdentifier,
  root: string,
  name: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/create-folder`, {
    method: 'POST',
    body: { root, name },
  });
}

export async function chmodFiles(
  id: ServerIdentifier,
  root: string,
  files: Array<{ file: string; mode: string }>,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/chmod`, {
    method: 'POST',
    body: { root, files },
  });
}

export async function pullRemoteFile(
  id: ServerIdentifier,
  opts: {
    url: string;
    directory?: string;
    filename?: string;
    useHeader?: boolean;
    foreground?: boolean;
  },
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/pull`, {
    method: 'POST',
    body: {
      url: opts.url,
      directory: opts.directory,
      filename: opts.filename,
      use_header: opts.useHeader,
      foreground: opts.foreground,
    },
  });
}
