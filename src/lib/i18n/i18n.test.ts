import { describe, it, expect } from 'vitest';
import { translate } from './index';

describe('translate', () => {
  it('returns the string for the locale', () => {
    expect(translate('ko', 'nav.servers')).toBe('서버');
    expect(translate('en', 'nav.servers')).toBe('Servers');
  });
  it('falls back to the key when missing', () => {
    expect(translate('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
});
