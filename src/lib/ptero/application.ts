import { pteroFetch } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type PteroItem,
  type PteroList,
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
  return servers.map((server) => toAccessible(server.attributes));
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
