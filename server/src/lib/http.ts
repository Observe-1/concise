import type { Request } from 'express';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Not authenticated') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/** Parse and validate a request body, throwing a 400 with issue details. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Validation failed', result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })));
  }
  return result.data;
}

/** Parse a positive-integer route param (e.g. /assets/:id). */
export function idParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`Invalid ${name}`);
  return id;
}

/** Optional ?<name>=YYYY-MM-DD query param. Returns undefined when absent. */
export function dateQueryParam(req: Request, name: string): string | undefined {
  const raw = req.query[name];
  if (raw === undefined) return undefined;
  const s = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw badRequest(`Invalid ${name}; expected YYYY-MM-DD`);
  }
  return s;
}

/**
 * Optional ?asOf=YYYY-MM-DD query param (historical view mode): read data as
 * of the end of that day. Returns undefined when absent.
 */
export function asOfParam(req: Request): string | undefined {
  return dateQueryParam(req, 'asOf');
}

/** Minimal cookie header parser (we only ever read one cookie). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
