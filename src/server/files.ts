'use server';

import type { Prisma, User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
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
type Ok<T extends object = object> = { ok: true } & T;

const MAX_FILE_CONTENT_BYTES = 1024 * 1024;

const noNul = (value: string) => !value.includes('\0');
const identifierSchema = z.string().length(8).refine(noNul, 'must not contain NUL');
const pathSchema = z
  .string()
  .min(1)
  .startsWith('/')
  .refine(noNul, 'must not contain NUL');
const fileNameSchema = z.string().min(1).refine(noNul, 'must not contain NUL');
const chmodModeSchema = z.string().regex(/^[0-7]{3,4}$/, 'must be an octal mode');
const urlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'must be an http or https URL');

const listInputSchema = z.object({ identifier: identifierSchema, directory: pathSchema });
const pathInputSchema = z.object({ identifier: identifierSchema, file: pathSchema });
const writeInputSchema = pathInputSchema.extend({ content: z.string() });
const rootFilesInputSchema = z.object({
  identifier: identifierSchema,
  root: pathSchema,
  files: z.array(fileNameSchema).min(1),
});
const folderInputSchema = z.object({
  identifier: identifierSchema,
  root: pathSchema,
  name: fileNameSchema,
});
const renameInputSchema = z.object({
  identifier: identifierSchema,
  root: pathSchema,
  files: z.array(z.object({ from: fileNameSchema, to: fileNameSchema })).min(1),
});
const decompressInputSchema = z.object({
  identifier: identifierSchema,
  root: pathSchema,
  file: fileNameSchema,
});
const chmodInputSchema = z.object({
  identifier: identifierSchema,
  root: pathSchema,
  files: z.array(z.object({ file: fileNameSchema, mode: chmodModeSchema })).min(1),
});
const pullInputSchema = z.object({
  identifier: identifierSchema,
  opts: z.object({
    url: urlSchema,
    directory: pathSchema.optional(),
    filename: fileNameSchema.optional(),
  }),
});

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { user, id };
}

function validationDetail(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function validateInput<T>(schema: ZodType<T>, value: unknown): T | Fail {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: 'failed', detail: validationDetail(parsed.error) };
  }
  return parsed.data;
}

function hasBinaryContent(content: string): boolean {
  return /[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(content);
}

function validateFileContent(content: string): Fail | null {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_CONTENT_BYTES) {
    return {
      ok: false,
      error: 'failed',
      detail: 'File content exceeds the 1 MiB limit.',
    };
  }

  if (hasBinaryContent(content)) {
    return {
      ok: false,
      error: 'failed',
      detail: 'Binary file content is not supported.',
    };
  }

  return null;
}

function redactUrl(value: string): string {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
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
    const input = validateInput(listInputSchema, { identifier, directory });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    return { ok: true, entries: await ptero.listFiles(id, input.directory) };
  } catch (err) {
    return toFail(err);
  }
}

export async function readFileAction(
  identifier: string,
  file: string,
): Promise<Ok<{ content: string }> | Fail> {
  try {
    const input = validateInput(pathInputSchema, { identifier, file });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    const content = await ptero.getFileContents(id, input.file);
    const invalidContent = validateFileContent(content);
    if (invalidContent) return invalidContent;
    return { ok: true, content };
  } catch (err) {
    return toFail(err);
  }
}

export async function writeFileAction(
  identifier: string,
  file: string,
  content: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(writeInputSchema, { identifier, file, content });
    if ('ok' in input) return input;
    const invalidContent = validateFileContent(input.content);
    if (invalidContent) return invalidContent;
    const { user, id } = await guard(input.identifier);
    await ptero.writeFile(id, input.file, input.content);
    await auditAction('file.write', {
      userId: user.id,
      target: id,
      metadata: { file: input.file },
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
): Promise<Ok | Fail> {
  try {
    const input = validateInput(rootFilesInputSchema, { identifier, root, files });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.deleteFiles(id, input.root, input.files);
    await auditAction('file.delete', {
      userId: user.id,
      target: id,
      metadata: { root: input.root, files: input.files },
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
): Promise<Ok | Fail> {
  try {
    const input = validateInput(folderInputSchema, { identifier, root, name });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.createFolder(id, input.root, input.name);
    await auditAction('file.create_folder', {
      userId: user.id,
      target: id,
      metadata: { root: input.root, name: input.name },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function renameAction(
  identifier: string,
  root: string,
  files: Array<{ from: string; to: string }>,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(renameInputSchema, { identifier, root, files });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.renameFiles(id, input.root, input.files);
    await auditAction('file.rename', {
      userId: user.id,
      target: id,
      metadata: { root: input.root, files: input.files },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function copyAction(
  identifier: string,
  location: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(pathInputSchema, { identifier, file: location });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.copyFile(id, input.file);
    await auditAction('file.copy', {
      userId: user.id,
      target: id,
      metadata: { location: input.file },
    });
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
    const input = validateInput(rootFilesInputSchema, { identifier, root, files });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    const archive = await ptero.compressFiles(id, input.root, input.files);
    await auditAction('file.compress', {
      userId: user.id,
      target: id,
      metadata: { root: input.root, files: input.files, archive: archive.name },
    });
    return { ok: true, archive };
  } catch (err) {
    return toFail(err);
  }
}

export async function decompressAction(
  identifier: string,
  root: string,
  file: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(decompressInputSchema, { identifier, root, file });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.decompressFile(id, input.root, input.file);
    await auditAction('file.decompress', {
      userId: user.id,
      target: id,
      metadata: { root: input.root, file: input.file },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function chmodAction(
  identifier: string,
  root: string,
  files: Array<{ file: string; mode: string }>,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(chmodInputSchema, { identifier, root, files });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.chmodFiles(id, input.root, input.files);
    await auditAction('file.chmod', {
      userId: user.id,
      target: id,
      metadata: { root: input.root, files: input.files },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function pullAction(
  identifier: string,
  opts: { url: string; directory?: string; filename?: string },
): Promise<Ok | Fail> {
  try {
    const input = validateInput(pullInputSchema, { identifier, opts });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.pullRemoteFile(id, input.opts);
    await auditAction('file.pull', {
      userId: user.id,
      target: id,
      metadata: { ...input.opts, url: redactUrl(input.opts.url) },
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
    const input = validateInput(pathInputSchema, { identifier, file });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    return { ok: true, url: await ptero.getFileDownloadUrl(id, input.file) };
  } catch (err) {
    return toFail(err);
  }
}

export async function getUploadUrlAction(
  identifier: string,
): Promise<Ok<{ url: string }> | Fail> {
  try {
    const input = validateInput(z.object({ identifier: identifierSchema }), { identifier });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    return { ok: true, url: await ptero.getFileUploadUrl(id) };
  } catch (err) {
    return toFail(err);
  }
}
