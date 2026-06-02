'use server';

import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { invalidateAccessCache } from '@/lib/authz/access';
import { AdminRequiredError, assertAdmin } from '@/lib/authz/admin';
import { syncServerAccess } from '@/lib/authz/sync';
import { PteroApiError, friendlyMessage } from '@/lib/ptero/errors';

type Fail = { ok: false; error: 'forbidden' | 'failed'; detail?: string };
type Ok<T extends object = object> = { ok: true } & T;

export async function syncServerAccessAction(): Promise<
  Ok<{ servers: number; subuserLinks: number }> | Fail
> {
  try {
    const user = await requireUser();
    assertAdmin(user);
    const result = await syncServerAccess();
    invalidateAccessCache();
    await audit('admin.scope.sync', {
      userId: user.id,
      metadata: {
        servers: result.servers,
        subuserLinks: result.subuserLinks,
      },
    });
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AdminRequiredError) {
      return { ok: false, error: 'forbidden' };
    }

    const detail = err instanceof PteroApiError ? friendlyMessage(err) : undefined;
    console.error('scope sync failed', err);
    return { ok: false, error: 'failed', detail };
  }
}
