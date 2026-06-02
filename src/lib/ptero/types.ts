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

export interface PteroUser {
  id: number;
  uuid: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  root_admin: boolean;
  created_at: string;
}

export interface CreatePteroUserInput {
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  password?: string;
  root_admin?: boolean;
  external_id?: string;
}

export interface PteroNode {
  id: number;
  name: string;
  fqdn: string;
  memory: number;
  memory_overallocate: number;
  disk: number;
  disk_overallocate: number;
  location_id: number;
  maintenance_mode: boolean;
}

export interface PteroLocation {
  id: number;
  short: string;
  long: string | null;
}

export interface PteroNest {
  id: number;
  name: string;
  description: string | null;
}

export interface PteroEggVariable {
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  rules: string;
  user_editable: boolean;
}

export interface PteroEgg {
  id: number;
  name: string;
  docker_image: string;
  startup: string;
  variables?: PteroEggVariable[];
}

export interface PteroServer {
  id: number;
  uuid: string;
  identifier: string;
  name: string;
  user: number;
  node: number;
  allocation?: number;
  egg?: number;
  docker_image?: string;
  startup?: string;
  suspended: boolean;
  limits: {
    memory: number;
    swap: number;
    disk: number;
    io: number;
    cpu: number;
  };
  feature_limits: {
    databases: number;
    allocations: number;
    backups: number;
  };
}

export interface CreateServerInput {
  name: string;
  user: number;
  egg: number;
  docker_image: string;
  startup: string;
  environment: Record<string, string>;
  limits: {
    memory: number;
    swap: number;
    disk: number;
    io: number;
    cpu: number;
  };
  feature_limits: {
    databases: number;
    allocations: number;
    backups: number;
  };
  deploy?: {
    locations: number[];
    dedicated_ip: boolean;
    port_range: string[];
  };
  allocation?: { default: number; additional?: number[] };
  start_on_completion?: boolean;
}

export interface UpdateServerBuildInput {
  allocation?: number;
  memory: number;
  swap: number;
  disk: number;
  io: number;
  cpu: number;
  feature_limits: {
    databases: number;
    allocations: number;
    backups: number;
  };
}

export interface UpdateServerStartupInput {
  startup: string;
  egg: number;
  image: string;
  environment: Record<string, string>;
  skip_scripts?: boolean;
}
