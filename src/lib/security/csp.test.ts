import { describe, expect, it } from 'vitest';
import {
  FRAME_CSP_BASELINE,
  buildFrameCsp,
  pluginIdFromPath,
  shouldSetCsp,
} from './csp';

describe('pluginIdFromPath', () => {
  it('extracts the pluginId from a plugin tab route', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d/plugin/pl1')).toBe('pl1');
  });
  it('allows a trailing slash', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d/plugin/pl1/')).toBe('pl1');
  });
  it('returns null for non-plugin routes', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d')).toBeNull();
    expect(pluginIdFromPath('/login')).toBeNull();
  });
  it('returns null when there is an extra path segment', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d/plugin/pl1/extra')).toBeNull();
  });
});

describe('buildFrameCsp', () => {
  it('denies all framing without an origin', () => {
    expect(buildFrameCsp(null)).toBe("frame-src 'none'; frame-ancestors 'none'");
    expect(buildFrameCsp(null)).toBe(FRAME_CSP_BASELINE);
  });
  it('allows the given plugin origin', () => {
    expect(buildFrameCsp('https://x.example')).toBe(
      "frame-src 'self' https://x.example; frame-ancestors 'none'",
    );
  });
});

describe('shouldSetCsp', () => {
  it('skips assets and APIs', () => {
    expect(shouldSetCsp('/_next/static/x.js')).toBe(false);
    expect(shouldSetCsp('/api/ext/servers')).toBe(false);
    expect(shouldSetCsp('/favicon.ico')).toBe(false);
  });
  it('applies to document routes', () => {
    expect(shouldSetCsp('/servers/1a2b3c4d')).toBe(true);
    expect(shouldSetCsp('/servers/1a2b3c4d/plugin/pl1')).toBe(true);
  });
});
