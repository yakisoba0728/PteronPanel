export interface PteroErrorDetail {
  code: string;
  status: string;
  detail: string;
  source?: { field?: string };
}

export class PteroApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errors: PteroErrorDetail[],
    readonly requestId?: string
  ) {
    super(errors[0]?.detail ?? `Pterodactyl API error (HTTP ${httpStatus})`);
    this.name = 'PteroApiError';
  }

  get primary(): PteroErrorDetail | undefined {
    return this.errors[0];
  }

  get field(): string | undefined {
    return this.errors[0]?.source?.field;
  }
}

export function parsePteroErrors(body: unknown): PteroErrorDetail[] {
  if (
    body &&
    typeof body === 'object' &&
    Array.isArray((body as { errors?: unknown }).errors)
  ) {
    return (body as { errors: PteroErrorDetail[] }).errors;
  }

  return [];
}
