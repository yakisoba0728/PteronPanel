import { pteroFetch } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type CreatePteroUserInput,
  type PteroItem,
  type PteroList,
  type PteroUser,
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
  const res = await pteroFetch<PteroList<AppUserAttrs>>('application', '/users', {
    query: { 'filter[email]': email },
  });
  const match = res.data.find((user) => user.attributes.email.toLowerCase() === email.toLowerCase());
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
