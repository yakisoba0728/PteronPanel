export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ServerNumericId = Brand<number, 'ServerNumericId'>;
export type ServerIdentifier = Brand<string, 'ServerIdentifier'>;
export type ServerUuid = Brand<string, 'ServerUuid'>;

export const asNumericId = (value: number): ServerNumericId =>
  value as ServerNumericId;

export function asIdentifier(value: string): ServerIdentifier {
  if (value.length !== 8) {
    throw new Error(
      `Invalid server identifier (expected 8 chars, got ${value.length}): ${value}`
    );
  }
  return value as ServerIdentifier;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asUuid(value: string): ServerUuid {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid server uuid: ${value}`);
  }
  return value as ServerUuid;
}

export interface PteroItem<A> {
  object: string;
  attributes: A;
  relationships?: Record<string, unknown>;
}

export interface Pagination {
  total: number;
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}

export interface PteroList<A> {
  object: 'list';
  data: PteroItem<A>[];
  meta: { pagination: Pagination };
}

export interface AccessibleServer {
  identifier: ServerIdentifier;
  uuid: ServerUuid;
  numericId?: ServerNumericId;
  name: string;
  node?: string;
}

export interface ServerResources {
  current_state: string;
  is_suspended: boolean;
  memory_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  uptime: number;
}

export interface WebsocketCredentials {
  token: string;
  socket: string;
}

export type PowerSignal = 'start' | 'stop' | 'restart' | 'kill';

export interface FileEntry {
  name: string;
  mode: string;
  mode_bits: string;
  size: number;
  is_file: boolean;
  is_symlink: boolean;
  mimetype: string;
  created_at: string;
  modified_at: string;
}

export interface BackupEntry {
  uuid: string;
  name: string;
  bytes: number;
  checksum: string | null;
  is_locked: boolean;
  is_successful: boolean;
  created_at: string;
  completed_at: string | null;
}
