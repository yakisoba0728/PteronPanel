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

export function friendlyMessage(err: PteroApiError): string {
  switch (err.httpStatus) {
    case 429:
      return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    case 409:
      return err.primary?.detail ?? '현재 상태에서는 처리할 수 없습니다.';
    case 413:
      return '파일이 너무 큽니다.';
    default:
      return err.primary?.detail ?? '오류가 발생했습니다.';
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
