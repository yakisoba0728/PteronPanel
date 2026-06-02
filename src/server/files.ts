'use server';

import type { Prisma, User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type FileEntry } from '@/lib/ptero/types';

function scope(user: User): ScopeUser {
  return {
    id: user.id,
    role: user.role,
    pteroUserId: user.pteroUserId,
  };
}

type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { user, id };
}

function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) {
    return { ok: false, error: 'not_found' };
  }

  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('file action failed', err);
  return { ok: false, error: 'failed', detail };
}

async function auditAction(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue },
): Promise<void> {
  const { audit } = await import('@/lib/audit');
  await audit(action, opts);
}

export async function listFilesAction(
  identifier: string,
  directory: string,
): Promise<Ok<{ entries: FileEntry[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, entries: await ptero.listFiles(id, directory) };
  } catch (err) {
    return toFail(err);
  }
}

export async function readFileAction(
  identifier: string,
  file: string,
): Promise<Ok<{ content: string }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, content: await ptero.getFileContents(id, file) };
  } catch (err) {
    return toFail(err);
  }
}

export async function writeFileAction(
  identifier: string,
  file: string,
  content: string,
): Promise<Ok<{}> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.writeFile(id, file, content);
    await auditAction('file.write', {
      userId: user.id,
      target: id,
      metadata: { file },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteFilesAction(
  identifier: string,
  root: string,
  files: string[],
): Promise<Ok<{}> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteFiles(id, root, files);
    await auditAction('file.delete', {
      userId: user.id,
      target: id,
      metadata: { root, files },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function createFolderAction(
  identifier: string,
  root: string,
  name: string,
): Promise<Ok<{}> | Fail> {
  try {
    const { id } = await guard(identifier);
    await ptero.createFolder(id, root, name);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function renameAction(
  identifier: string,
  root: string,
  files: Array<{ from: string; to: string }>,
): Promise<Ok<{}> | Fail> {
  try {
    const { id } = await guard(identifier);
    await ptero.renameFiles(id, root, files);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function compressAction(
  identifier: string,
  root: string,
  files: string[],
): Promise<Ok<{ archive: FileEntry }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, archive: await ptero.compressFiles(id, root, files) };
  } catch (err) {
    return toFail(err);
  }
}

export async function decompressAction(
  identifier: string,
  root: string,
  file: string,
): Promise<Ok<{}> | Fail> {
  try {
    const { id } = await guard(identifier);
    await ptero.decompressFile(id, root, file);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function chmodAction(
  identifier: string,
  root: string,
  files: Array<{ file: string; mode: string }>,
): Promise<Ok<{}> | Fail> {
  try {
    const { id } = await guard(identifier);
    await ptero.chmodFiles(id, root, files);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function pullAction(
  identifier: string,
  opts: { url: string; directory?: string; filename?: string },
): Promise<Ok<{}> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.pullRemoteFile(id, opts);
    await auditAction('file.pull', {
      userId: user.id,
      target: id,
      metadata: opts,
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function getDownloadUrlAction(
  identifier: string,
  file: string,
): Promise<Ok<{ url: string }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, url: await ptero.getFileDownloadUrl(id, file) };
  } catch (err) {
    return toFail(err);
  }
}

export async function getUploadUrlAction(
  identifier: string,
): Promise<Ok<{ url: string }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, url: await ptero.getFileUploadUrl(id) };
  } catch (err) {
    return toFail(err);
  }
}
