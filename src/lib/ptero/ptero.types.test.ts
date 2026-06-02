import { describe, it, expect } from 'vitest';
import { asIdentifier, asUuid } from './types';
import { PteroApiError, parsePteroErrors } from './errors';

describe('branded identifiers', () => {
  it('accepts a valid 8-char identifier', () => {
    expect(asIdentifier('1a2b3c4d')).toBe('1a2b3c4d');
  });

  it('rejects a non-8-char identifier', () => {
    expect(() => asIdentifier('short')).toThrow(/identifier/i);
  });

  it('accepts a valid uuid and rejects garbage', () => {
    expect(asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef')).toMatch(/^1a2b3c4d/);
    expect(() => asUuid('not-a-uuid')).toThrow(/uuid/i);
  });
});

describe('ptero errors', () => {
  it('parses the error envelope and surfaces the first detail', () => {
    const body = {
      errors: [{ code: 'NotFoundHttpException', status: '404', detail: 'Not found.' }],
    };
    const details = parsePteroErrors(body);
    const err = new PteroApiError(404, details, 'req-123');
    expect(err.httpStatus).toBe(404);
    expect(err.message).toBe('Not found.');
    expect(err.requestId).toBe('req-123');
  });

  it('returns [] for a non-envelope body', () => {
    expect(parsePteroErrors('oops')).toEqual([]);
  });
});
