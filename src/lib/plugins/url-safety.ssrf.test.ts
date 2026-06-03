import { afterEach, describe, expect, it } from 'vitest';
import { validateExternalHttpUrl } from './url-safety';

afterEach(() => {
  delete process.env.PTERON_ALLOW_LOCAL_WEBHOOKS;
});

describe('SSRF IPv6 blocklist bypass (IPv4-mapped, IPv4-compatible, NAT64)', () => {
  it('blocks IPv4-mapped loopback in hex form (::ffff:7f00:1)', () => {
    // new URL('http://[::ffff:127.0.0.1]/').hostname === '[::ffff:7f00:1]'
    expect(validateExternalHttpUrl('http://[::ffff:127.0.0.1]/')).toBeNull();
  });

  it('blocks IPv4-mapped private RFC1918 in hex form', () => {
    expect(validateExternalHttpUrl('http://[::ffff:10.0.0.5]/')).toBeNull();
  });

  it('blocks NAT64-embedded loopback (64:ff9b::/96)', () => {
    expect(validateExternalHttpUrl('http://[64:ff9b::7f00:1]/')).toBeNull();
  });

  it('blocks IPv4-compatible (deprecated ::/96) embedded loopback', () => {
    // new URL('http://[::127.0.0.1]/').hostname === '[::7f00:1]'
    expect(validateExternalHttpUrl('http://[::127.0.0.1]/')).toBeNull();
  });

  it('blocks plain IPv6 loopback ::1', () => {
    expect(validateExternalHttpUrl('http://[::1]/')).toBeNull();
  });

  it('blocks link-local fe80::/10', () => {
    expect(validateExternalHttpUrl('http://[fe80::1]/')).toBeNull();
  });

  it('blocks ULA fc00::/7', () => {
    expect(validateExternalHttpUrl('http://[fc00::1]/')).toBeNull();
    expect(validateExternalHttpUrl('http://[fd12:3456::1]/')).toBeNull();
  });

  it('blocks unspecified ::', () => {
    expect(validateExternalHttpUrl('http://[::]/')).toBeNull();
  });

  it('does NOT block a real public IPv6 address (Cloudflare 2606:4700:4700::1111)', () => {
    expect(
      validateExternalHttpUrl('http://[2606:4700:4700::1111]/')?.hostname,
    ).toBe('[2606:4700:4700::1111]');
  });

  it('does NOT block an IPv4-mapped *public* address', () => {
    // ::ffff:1.1.1.1 maps to public 1.1.1.1
    expect(
      validateExternalHttpUrl('http://[::ffff:1.1.1.1]/')?.hostname,
    ).toBe('[::ffff:101:101]');
  });
});
