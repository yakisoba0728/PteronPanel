import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

function req(path: string, withCookie = false) {
  return new NextRequest(`http://localhost${path}`, {
    headers: withCookie ? { cookie: 'pteron_session=abc' } : {},
  });
}

describe('auth middleware', () => {
  it('redirects unauthenticated users to /login', () => {
    const res = middleware(req('/servers'));
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows authenticated users through', () => {
    const res = middleware(req('/servers', true));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects authenticated users away from /login', () => {
    const res = middleware(req('/login', true));
    expect(res.headers.get('location')).toContain('/servers');
  });

  it('allows unauthenticated access to /login', () => {
    const res = middleware(req('/login'));
    expect(res.headers.get('location')).toBeNull();
  });
});
