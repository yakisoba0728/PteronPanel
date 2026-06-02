import { pteroFetch, pteroFetchText } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type ActivityEntry,
  type BackupEntry,
  type FileEntry,
  type PowerSignal,
  type PteroItem,
  type PteroList,
  type ScheduleInput,
  type ScheduleTask,
  type ServerAllocation,
  type ServerDatabase,
  type ServerIdentifier,
  type ServerResources,
  type ServerSchedule,
  type StartupVariable,
  type Subuser,
  type TaskInput,
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

function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%252E');
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

export async function listBackups(
  id: ServerIdentifier,
): Promise<BackupEntry[]> {
  const first = await pteroFetch<PteroList<BackupEntry>>(
    'client',
    `/servers/${id}/backups`,
    { query: { per_page: 50, page: 1 } },
  );
  const data = [...first.data];
  const totalPages = first.meta.pagination.total_pages;

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await pteroFetch<PteroList<BackupEntry>>(
      'client',
      `/servers/${id}/backups`,
      { query: { per_page: 50, page } },
    );
    data.push(...next.data);
  }

  return data.map((item) => item.attributes);
}

export async function getBackup(
  id: ServerIdentifier,
  backupUuid: string,
): Promise<BackupEntry> {
  const response = await pteroFetch<{ attributes: BackupEntry }>(
    'client',
    `/servers/${id}/backups/${pathSegment(backupUuid)}`,
  );

  return response.attributes;
}

export async function createBackup(
  id: ServerIdentifier,
  opts: { name?: string; ignored?: string; isLocked?: boolean } = {},
): Promise<BackupEntry> {
  const response = await pteroFetch<{ attributes: BackupEntry }>(
    'client',
    `/servers/${id}/backups`,
    {
      method: 'POST',
      body: {
        name: opts.name,
        ignored: opts.ignored,
        is_locked: opts.isLocked,
      },
    },
  );

  return response.attributes;
}

export async function getBackupDownloadUrl(
  id: ServerIdentifier,
  backupUuid: string,
): Promise<string> {
  const response = await pteroFetch<SignedUrl>(
    'client',
    `/servers/${id}/backups/${pathSegment(backupUuid)}/download`,
  );

  return response.attributes.url;
}

export async function toggleBackupLock(
  id: ServerIdentifier,
  backupUuid: string,
): Promise<BackupEntry> {
  const response = await pteroFetch<{ attributes: BackupEntry }>(
    'client',
    `/servers/${id}/backups/${pathSegment(backupUuid)}/lock`,
    { method: 'POST' },
  );

  return response.attributes;
}

export async function restoreBackup(
  id: ServerIdentifier,
  backupUuid: string,
  truncate = false,
): Promise<void> {
  await pteroFetch(
    'client',
    `/servers/${id}/backups/${pathSegment(backupUuid)}/restore`,
    {
      method: 'POST',
      body: { truncate },
    },
  );
}

export async function deleteBackup(
  id: ServerIdentifier,
  backupUuid: string,
): Promise<void> {
  await pteroFetch(
    'client',
    `/servers/${id}/backups/${pathSegment(backupUuid)}`,
    {
      method: 'DELETE',
    },
  );
}

interface SchedAttrs {
  id: number;
  name: string;
  cron: ServerSchedule['cron'];
  is_active: boolean;
  is_processing: boolean;
  only_when_online: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  relationships?: { tasks?: { data: { attributes: ScheduleTask }[] } };
}

function mapSchedule(attrs: SchedAttrs): ServerSchedule {
  return {
    id: attrs.id,
    name: attrs.name,
    cron: attrs.cron,
    is_active: attrs.is_active,
    is_processing: attrs.is_processing,
    only_when_online: attrs.only_when_online,
    last_run_at: attrs.last_run_at,
    next_run_at: attrs.next_run_at,
    tasks: (attrs.relationships?.tasks?.data ?? []).map((task) => task.attributes),
  };
}

export async function listSchedules(
  id: ServerIdentifier,
): Promise<ServerSchedule[]> {
  const response = await pteroFetch<PteroList<SchedAttrs>>(
    'client',
    `/servers/${id}/schedules`,
    { query: { include: 'tasks' } },
  );

  return response.data.map((item) => mapSchedule(item.attributes));
}

export async function createSchedule(
  id: ServerIdentifier,
  input: ScheduleInput,
): Promise<ServerSchedule> {
  const response = await pteroFetch<PteroItem<SchedAttrs>>(
    'client',
    `/servers/${id}/schedules`,
    { method: 'POST', body: input },
  );

  return mapSchedule(response.attributes);
}

export async function updateSchedule(
  id: ServerIdentifier,
  schedId: number,
  input: ScheduleInput,
): Promise<ServerSchedule> {
  const response = await pteroFetch<PteroItem<SchedAttrs>>(
    'client',
    `/servers/${id}/schedules/${pathSegment(schedId)}`,
    { method: 'POST', body: input },
  );

  return mapSchedule(response.attributes);
}

export async function deleteSchedule(
  id: ServerIdentifier,
  schedId: number,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/schedules/${pathSegment(schedId)}`, {
    method: 'DELETE',
  });
}

export async function executeSchedule(
  id: ServerIdentifier,
  schedId: number,
): Promise<void> {
  await pteroFetch(
    'client',
    `/servers/${id}/schedules/${pathSegment(schedId)}/execute`,
    { method: 'POST' },
  );
}

export async function createTask(
  id: ServerIdentifier,
  schedId: number,
  input: TaskInput,
): Promise<ScheduleTask> {
  const response = await pteroFetch<PteroItem<ScheduleTask>>(
    'client',
    `/servers/${id}/schedules/${pathSegment(schedId)}/tasks`,
    { method: 'POST', body: input },
  );

  return response.attributes;
}

export async function updateTask(
  id: ServerIdentifier,
  schedId: number,
  taskId: number,
  input: TaskInput,
): Promise<ScheduleTask> {
  const response = await pteroFetch<PteroItem<ScheduleTask>>(
    'client',
    `/servers/${id}/schedules/${pathSegment(schedId)}/tasks/${pathSegment(taskId)}`,
    { method: 'POST', body: input },
  );

  return response.attributes;
}

export async function deleteTask(
  id: ServerIdentifier,
  schedId: number,
  taskId: number,
): Promise<void> {
  await pteroFetch(
    'client',
    `/servers/${id}/schedules/${pathSegment(schedId)}/tasks/${pathSegment(taskId)}`,
    { method: 'DELETE' },
  );
}

export async function listSubusers(id: ServerIdentifier): Promise<Subuser[]> {
  const response = await pteroFetch<PteroList<Subuser>>(
    'client',
    `/servers/${id}/users`,
  );

  return response.data.map((item) => item.attributes);
}

export async function createSubuser(
  id: ServerIdentifier,
  email: string,
  permissions: string[],
): Promise<Subuser> {
  const response = await pteroFetch<PteroItem<Subuser>>(
    'client',
    `/servers/${id}/users`,
    { method: 'POST', body: { email, permissions } },
  );

  return response.attributes;
}

export async function updateSubuser(
  id: ServerIdentifier,
  subuserUuid: string,
  permissions: string[],
): Promise<Subuser> {
  const response = await pteroFetch<PteroItem<Subuser>>(
    'client',
    `/servers/${id}/users/${pathSegment(subuserUuid)}`,
    { method: 'POST', body: { permissions } },
  );

  return response.attributes;
}

export async function deleteSubuser(
  id: ServerIdentifier,
  subuserUuid: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/users/${pathSegment(subuserUuid)}`, {
    method: 'DELETE',
  });
}

export async function listPermissionKeys(): Promise<string[]> {
  const response = await pteroFetch<{
    attributes: {
      permissions: Record<string, { keys: Record<string, string> }>;
    };
  }>('client', '/permissions');
  const keys: string[] = [];

  for (const [group, definition] of Object.entries(
    response.attributes.permissions,
  )) {
    if (group === 'websocket') continue;
    for (const key of Object.keys(definition.keys)) {
      keys.push(`${group}.${key}`);
    }
  }

  return keys;
}

interface DbAttrs {
  id: string;
  name: string;
  username: string;
  host: { address: string; port: number };
  connections_from: string;
  max_connections: number;
  relationships?: {
    password?: { attributes: { password: string } };
  };
}

function mapDb(attrs: DbAttrs): ServerDatabase {
  return {
    id: attrs.id,
    name: attrs.name,
    username: attrs.username,
    host: attrs.host,
    connections_from: attrs.connections_from,
    max_connections: attrs.max_connections,
    password: attrs.relationships?.password?.attributes.password,
  };
}

export async function listDatabases(
  id: ServerIdentifier,
): Promise<ServerDatabase[]> {
  const response = await pteroFetch<PteroList<DbAttrs>>(
    'client',
    `/servers/${id}/databases`,
    { query: { include: 'password' } },
  );

  return response.data.map((item) => mapDb(item.attributes));
}

export async function createDatabase(
  id: ServerIdentifier,
  input: { database: string; remote: string },
): Promise<ServerDatabase> {
  const response = await pteroFetch<PteroItem<DbAttrs>>(
    'client',
    `/servers/${id}/databases`,
    { method: 'POST', body: input },
  );

  return mapDb(response.attributes);
}

export async function rotateDatabasePassword(
  id: ServerIdentifier,
  dbId: string,
): Promise<ServerDatabase> {
  const response = await pteroFetch<PteroItem<DbAttrs>>(
    'client',
    `/servers/${id}/databases/${pathSegment(dbId)}/rotate-password`,
    { method: 'POST' },
  );

  return mapDb(response.attributes);
}

export async function deleteDatabase(
  id: ServerIdentifier,
  dbId: string,
): Promise<void> {
  await pteroFetch(
    'client',
    `/servers/${id}/databases/${pathSegment(dbId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function listAllocations(
  id: ServerIdentifier,
): Promise<ServerAllocation[]> {
  const response = await pteroFetch<PteroList<ServerAllocation>>(
    'client',
    `/servers/${id}/network/allocations`,
  );

  return response.data.map((item) => item.attributes);
}

export async function assignAllocation(
  id: ServerIdentifier,
): Promise<ServerAllocation> {
  const response = await pteroFetch<PteroItem<ServerAllocation>>(
    'client',
    `/servers/${id}/network/allocations`,
    { method: 'POST' },
  );

  return response.attributes;
}

export async function setAllocationNote(
  id: ServerIdentifier,
  allocId: number,
  notes: string,
): Promise<ServerAllocation> {
  const response = await pteroFetch<PteroItem<ServerAllocation>>(
    'client',
    `/servers/${id}/network/allocations/${pathSegment(allocId)}`,
    { method: 'POST', body: { notes } },
  );

  return response.attributes;
}

export async function setPrimaryAllocation(
  id: ServerIdentifier,
  allocId: number,
): Promise<ServerAllocation> {
  const response = await pteroFetch<PteroItem<ServerAllocation>>(
    'client',
    `/servers/${id}/network/allocations/${pathSegment(allocId)}/primary`,
    { method: 'POST' },
  );

  return response.attributes;
}

export async function deleteAllocation(
  id: ServerIdentifier,
  allocId: number,
): Promise<void> {
  await pteroFetch(
    'client',
    `/servers/${id}/network/allocations/${pathSegment(allocId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function getStartupVariables(
  id: ServerIdentifier,
): Promise<StartupVariable[]> {
  const response = await pteroFetch<PteroList<StartupVariable>>(
    'client',
    `/servers/${id}/startup`,
  );

  return response.data.map((item) => item.attributes);
}

export async function updateStartupVariable(
  id: ServerIdentifier,
  key: string,
  value: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/startup/variable`, {
    method: 'PUT',
    body: { key, value },
  });
}

export async function renameServer(
  id: ServerIdentifier,
  name: string,
  description?: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/settings/rename`, {
    method: 'POST',
    body: { name, description },
  });
}

export async function reinstallServer(id: ServerIdentifier): Promise<void> {
  await pteroFetch('client', `/servers/${id}/settings/reinstall`, {
    method: 'POST',
  });
}

export async function setDockerImage(
  id: ServerIdentifier,
  dockerImage: string,
): Promise<void> {
  await pteroFetch('client', `/servers/${id}/settings/docker-image`, {
    method: 'PUT',
    body: { docker_image: dockerImage },
  });
}

export async function listActivity(
  id: ServerIdentifier,
): Promise<ActivityEntry[]> {
  const response = await pteroFetch<PteroList<ActivityEntry>>(
    'client',
    `/servers/${id}/activity`,
    { query: { per_page: 50 } },
  );

  return response.data.map((item) => item.attributes);
}
