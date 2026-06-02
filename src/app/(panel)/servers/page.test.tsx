import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { listMyServers } = vi.hoisted(() => ({
  listMyServers: vi.fn(),
}));

vi.mock('@/server/servers', () => ({
  listMyServers,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('ServersPage', () => {
  it('renders the empty state when no servers are accessible', async () => {
    listMyServers.mockResolvedValue([]);
    const { default: ServersPage } = await import('./page');
    const markup = renderToStaticMarkup(await ServersPage());

    expect(markup).toContain('접근 가능한 서버가 없습니다.');
  });

  it('renders a server card for each accessible server', async () => {
    listMyServers.mockResolvedValue([
      {
        identifier: '1a2b3c4d',
        uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
        name: 'Alpha',
        node: 'Node 01',
      },
    ]);
    const { default: ServersPage } = await import('./page');
    const markup = renderToStaticMarkup(await ServersPage());

    expect(markup).toContain('Alpha');
    expect(markup).toContain('href="/servers/1a2b3c4d"');
  });
});
