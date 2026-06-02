import { describe, it, expect } from 'vitest';
import { parseConfig } from './config';

const valid = {
  PANEL_URL: 'https://panel.example.com',
  PTERO_APP_KEY: 'ptla_abc',
  PTERO_CLIENT_KEY: 'ptlc_abc',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SECRET: 'a-very-long-secret-value',
  APP_BASE_URL: 'http://localhost:3000',
} as unknown as NodeJS.ProcessEnv;

describe('parseConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const cfg = parseConfig(valid);
    expect(cfg.PANEL_URL).toBe('https://panel.example.com');
    expect(cfg.SESSION_TTL_HOURS).toBe(12);
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('throws with a readable message when PANEL_URL is missing', () => {
    const rest = { ...valid };
    delete rest.PANEL_URL;
    expect(() => parseConfig(rest as unknown as NodeJS.ProcessEnv)).toThrow(/PANEL_URL/);
  });

  it('rejects a too-short SESSION_SECRET', () => {
    expect(() => parseConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/
    );
  });
});
