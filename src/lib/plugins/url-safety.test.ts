import { afterEach, describe, expect, it } from 'vitest';
import { validateExternalHttpUrl, validatePluginUiUrl } from './url-safety';

afterEach(() => {
  delete process.env.PTERON_ALLOW_LOCAL_WEBHOOKS;
});

describe('webhook URL safety', () => {
  it('accepts public http and https URLs', () => {
    expect(validateExternalHttpUrl('https://example.com/hook')?.origin).toBe(
      'https://example.com',
    );
    expect(validateExternalHttpUrl('http://example.com/hook')?.origin).toBe(
      'http://example.com',
    );
  });

  it('rejects non-http schemes and local/private addresses by default', () => {
    expect(validateExternalHttpUrl('file:///etc/passwd')).toBeNull();
    expect(validateExternalHttpUrl('http://localhost:3000/hook')).toBeNull();
    expect(validateExternalHttpUrl('http://127.0.0.1:3000/hook')).toBeNull();
    expect(validateExternalHttpUrl('http://10.0.0.2/hook')).toBeNull();
    expect(validateExternalHttpUrl('http://192.168.1.5/hook')).toBeNull();
    expect(validateExternalHttpUrl('http://[::1]/hook')).toBeNull();
  });

  it('allows local webhooks only when explicitly enabled', () => {
    process.env.PTERON_ALLOW_LOCAL_WEBHOOKS = '1';
    expect(validateExternalHttpUrl('http://127.0.0.1:3000/hook')?.hostname).toBe(
      '127.0.0.1',
    );
  });

  it('requires https plugin UI URLs unless local URLs are explicitly enabled', () => {
    expect(validatePluginUiUrl('http://example.com/ui')).toBeNull();
    expect(validatePluginUiUrl('https://example.com/ui')?.protocol).toBe('https:');

    process.env.PTERON_ALLOW_LOCAL_WEBHOOKS = '1';
    expect(validatePluginUiUrl('http://127.0.0.1:3000/ui')?.hostname).toBe(
      '127.0.0.1',
    );
  });
});
