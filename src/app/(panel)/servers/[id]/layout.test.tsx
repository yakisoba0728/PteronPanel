import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { asIdentifier, asUuid } from '@/lib/ptero/types';

const { requireUser, resolveAccessibleServers, ownerPluginTabs, notFound } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveAccessibleServers: vi.fn(),
  ownerPluginTabs: vi.fn(),
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

vi.mock('@/lib/plugins/owner-tabs', () => ({
  ownerPluginTabs,
}));

describe('ServerLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    ownerPluginTabs.mockResolvedValue([
      { key: 'plugin:pl1', label: 'Plugin Tab', href: '/servers/1a2b3c4d/plugin/pl1' },
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
    expect(markup).toContain('href="/servers/1a2b3c4d/plugin/pl1"');
    expect(markup).toContain('Body');
  });

  it('throws notFound for a malformed identifier (not 8 chars)', async () => {
    const { default: ServerLayout } = await import('./layout');

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });

    await expect(
      ServerLayout({
        children: <p>Body</p>,
        params: Promise.resolve({ id: 'short' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(resolveAccessibleServers).not.toHaveBeenCalled();
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
