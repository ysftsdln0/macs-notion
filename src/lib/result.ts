import { type AppError, type ErrorCode, errorMessages } from '@/lib/errors'

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, fields?: Record<string, string>): Result<never> {
  const error: AppError = { code, message: errorMessages[code] }
  if (fields) error.fields = fields
  return { ok: false, error }
}
