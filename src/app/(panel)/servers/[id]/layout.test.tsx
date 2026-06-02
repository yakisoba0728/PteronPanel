import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { asIdentifier, asUuid } from '@/lib/ptero/types';

const { requireUser, resolveAccessibleServers, notFound } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveAccessibleServers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound,
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser,
}));

vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers,
}));

describe('ServerLayout', () => {
  it('renders the server header and built-in tabs when access is allowed', async () => {
    const { default: ServerLayout } = await import('./layout');

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
    resolveAccessibleServers.mockResolvedValue([
      {
        identifier: asIdentifier('1a2b3c4d'),
        uuid: asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef'),
        name: 'Alpha',
      },
    ]);

    const markup = renderToStaticMarkup(
      await ServerLayout({
        children: <p>Body</p>,
        params: Promise.resolve({ id: '1a2b3c4d' }),
      }),
    );

    expect(markup).toContain('Alpha');
    expect(markup).toContain('href="/servers/1a2b3c4d"');
    expect(markup).toContain('href="/servers/1a2b3c4d/console"');
    expect(markup).toContain('Body');
  });

  it('throws notFound when access is denied', async () => {
    const { default: ServerLayout } = await import('./layout');

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
    resolveAccessibleServers.mockResolvedValue([]);

    await expect(
      ServerLayout({
        children: <p>Body</p>,
        params: Promise.resolve({ id: '1a2b3c4d' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
