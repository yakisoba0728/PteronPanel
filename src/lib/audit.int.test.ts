import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { audit } from './audit';

describe('audit (integration)', () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'test.action' } });
    await prisma.$disconnect();
  });

  it('records an audit log row', async () => {
    await audit('test.action', { target: 'srv-1', metadata: { a: 1 } });
    const row = await prisma.auditLog.findFirst({ where: { action: 'test.action' } });
    expect(row?.target).toBe('srv-1');
  });
});
