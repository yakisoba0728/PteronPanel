import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { asIdentifier, asUuid } from '@/lib/ptero/types';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('ServerCard', () => {
  it('links to the server overview', async () => {
    const { ServerCard } = await import('./server-card');
    const markup = renderToStaticMarkup(
      <ServerCard
        server={{
          identifier: asIdentifier('1a2b3c4d'),
          uuid: asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef'),
          name: 'Alpha',
          node: 'Node 01',
        }}
      />,
    );

    expect(markup).toContain('href="/servers/1a2b3c4d"');
    expect(markup).toContain('Alpha');
    expect(markup).toContain('Node 01');
  });
});
