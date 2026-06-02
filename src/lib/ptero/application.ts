import { pteroFetch } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type CreateServerInput,
  type CreatePteroUserInput,
  type PteroEgg,
  type PteroEggVariable,
  type PteroItem,
  type PteroList,
  type PteroLocation,
  type PteroNest,
  type PteroNode,
  type PteroServer,
  type PteroUser,
  type UpdateServerBuildInput,
  type UpdateServerStartupInput,
} from './types';

interface AppServerAttrs {
  id: number;
  identifier: string;
  uuid: string;
  name: string;
  node?: number;
}

interface AppUserAttrs {
  id: number;
  uuid: string;
  email: string;
}

function toAccessible(attrs: AppServerAttrs): AccessibleServer {
  return {
    identifier: asIdentifier(attrs.identifier),
    uuid: asUuid(attrs.uuid),
    numericId: asNumericId(attrs.id),
    name: attrs.name,
    accessKind: 'owner',
  };
}

export async function getOwnedServers(
  pteroUserId: number
): Promise<AccessibleServer[]> {
  const response = await pteroFetch<
    PteroItem<{ relationships?: { servers?: PteroList<AppServerAttrs> } }>
  >('application', `/users/${pteroUserId}`, { query: { include: 'servers' } });

  const servers = response.attributes.relationships?.servers?.data ?? [];
  // Map each row defensively: a single malformed row (e.g. an invalid
  // identifier/uuid) must not throw away the entire list. Skip and warn.
  return servers.flatMap((server) => {
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

export async function paginateAll<A>(
  fetchPage: (page: number) => Promise<PteroList<A>>
): Promise<PteroItem<A>[]> {
  const firstPage = await fetchPage(1);
  const items: PteroItem<A>[] = [...firstPage.data];
  const totalPages = firstPage.meta.pagination.total_pages;

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await fetchPage(page);
    items.push(...nextPage.data);
  }

  return items;
}

/** Find a Pterodactyl user by exact email (for mapping Pteron accounts). */
export async function findUserByEmail(
  email: string
): Promise<{ id: number; uuid: string } | null> {
  const items = await paginateAll<AppUserAttrs>((page) =>
    pteroFetch('application', '/users', {
      query: { 'filter[email]': email, page },
    }),
  );
  const target = email.toLowerCase();
  const match = items.find(
    (user) => user.attributes.email.toLowerCase() === target,
  );
  return match ? { id: match.attributes.id, uuid: match.attributes.uuid } : null;
}

export async function listUsers(): Promise<PteroUser[]> {
  const items = await paginateAll<PteroUser>((page) =>
    pteroFetch('application', '/users', { query: { page, per_page: 100 } }),
  );
  return items.map((item) => item.attributes);
}

export async function getUser(id: number): Promise<PteroUser> {
  const res = await pteroFetch<PteroItem<PteroUser>>(
    'application',
    `/users/${id}`,
  );
  return res.attributes;
}

export async function createUser(
  input: CreatePteroUserInput,
): Promise<PteroUser> {
  const res = await pteroFetch<PteroItem<PteroUser>>('application', '/users', {
    method: 'POST',
    body: input,
  });
  return res.attributes;
}

export async function updateUser(
  id: number,
  input: Partial<CreatePteroUserInput>,
): Promise<PteroUser> {
  const res = await pteroFetch<PteroItem<PteroUser>>(
    'application',
    `/users/${id}`,
    { method: 'PATCH', body: input },
  );
  return res.attributes;
}

export async function deleteUser(id: number): Promise<void> {
  await pteroFetch('application', `/users/${id}`, { method: 'DELETE' });
}

export async function listNodes(): Promise<PteroNode[]> {
  const items = await paginateAll<PteroNode>((page) =>
    pteroFetch('application', '/nodes', { query: { page, per_page: 100 } }),
  );
  return items.map((item) => item.attributes);
}

export async function getNode(id: number): Promise<PteroNode> {
  const res = await pteroFetch<PteroItem<PteroNode>>(
    'application',
    `/nodes/${id}`,
  );
  return res.attributes;
}

export async function listLocations(): Promise<PteroLocation[]> {
  const items = await paginateAll<PteroLocation>((page) =>
    pteroFetch('application', '/locations', {
      query: { page, per_page: 100 },
    }),
  );
  return items.map((item) => item.attributes);
}

export async function createLocation(input: {
  short: string;
  long?: string;
}): Promise<PteroLocation> {
  const res = await pteroFetch<PteroItem<PteroLocation>>(
    'application',
    '/locations',
    { method: 'POST', body: input },
  );
  return res.attributes;
}

export async function updateLocation(
  id: number,
  input: { short?: string; long?: string },
): Promise<PteroLocation> {
  const res = await pteroFetch<PteroItem<PteroLocation>>(
    'application',
    `/locations/${id}`,
    { method: 'PATCH', body: input },
  );
  return res.attributes;
}

export async function deleteLocation(id: number): Promise<void> {
  await pteroFetch('application', `/locations/${id}`, { method: 'DELETE' });
}

export async function listNests(): Promise<PteroNest[]> {
  const items = await paginateAll<PteroNest>((page) =>
    pteroFetch('application', '/nests', { query: { page, per_page: 100 } }),
  );
  return items.map((item) => item.attributes);
}

export async function listEggs(nestId: number): Promise<PteroEgg[]> {
  const items = await paginateAll<PteroEgg>((page) =>
    pteroFetch('application', `/nests/${nestId}/eggs`, {
      query: { page, per_page: 100 },
    }),
  );
  return items.map((item) => item.attributes);
}

export async function getEgg(
  nestId: number,
  eggId: number,
): Promise<PteroEgg> {
  const res = await pteroFetch<
    PteroItem<
      PteroEgg & {
        relationships?: { variables?: PteroList<PteroEggVariable> };
      }
    >
  >('application', `/nests/${nestId}/eggs/${eggId}`, {
    query: { include: 'variables' },
  });
  const variables =
    res.attributes.relationships?.variables?.data.map(
      (item) => item.attributes,
    ) ?? [];

  return {
    id: res.attributes.id,
    name: res.attributes.name,
    docker_image: res.attributes.docker_image,
    startup: res.attributes.startup,
    variables,
  };
}

export async function listAllServers(): Promise<PteroServer[]> {
  const items = await paginateAll<PteroServer>((page) =>
    pteroFetch('application', '/servers', { query: { page, per_page: 100 } }),
  );
  return items.map((item) => item.attributes);
}

export async function getServerAdmin(id: number): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>(
    'application',
    `/servers/${id}`,
  );
  return res.attributes;
}

export async function createServer(
  input: CreateServerInput,
): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>(
    'application',
    '/servers',
    { method: 'POST', body: input },
  );
  return res.attributes;
}

export async function updateServerDetails(
  id: number,
  input: {
    name?: string;
    user?: number;
    external_id?: string;
    description?: string;
  },
): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>(
    'application',
    `/servers/${id}/details`,
    { method: 'PATCH', body: input },
  );
  return res.attributes;
}

export async function updateServerBuild(
  id: number,
  input: UpdateServerBuildInput,
): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>(
    'application',
    `/servers/${id}/build`,
    { method: 'PATCH', body: input },
  );
  return res.attributes;
}

export async function updateServerStartup(
  id: number,
  input: UpdateServerStartupInput,
): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>(
    'application',
    `/servers/${id}/startup`,
    { method: 'PATCH', body: input },
  );
  return res.attributes;
}

export async function suspendServer(id: number): Promise<void> {
  await pteroFetch('application', `/servers/${id}/suspend`, {
    method: 'POST',
  });
}

export async function unsuspendServer(id: number): Promise<void> {
  await pteroFetch('application', `/servers/${id}/unsuspend`, {
    method: 'POST',
  });
}

export async function reinstallServer(id: number): Promise<void> {
  await pteroFetch('application', `/servers/${id}/reinstall`, {
    method: 'POST',
  });
}

export async function deleteServer(
  id: number,
  force = false,
): Promise<void> {
  await pteroFetch('application', `/servers/${id}${force ? '/force' : ''}`, {
    method: 'DELETE',
  });
}
