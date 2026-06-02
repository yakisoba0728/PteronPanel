import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function audit(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue; ip?: string } = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: opts.userId,
        target: opts.target,
        metadata: opts.metadata,
        ip: opts.ip,
      },
    });
  } catch (err) {
    console.error('audit log failed', { action, err });
  }
}
