import { z } from 'zod';

const EnvSchema = z.object({
  PANEL_URL: z.string().url(),
  PTERO_APP_KEY: z.string().min(1),
  PTERO_CLIENT_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  return (cached ??= parseConfig());
}
