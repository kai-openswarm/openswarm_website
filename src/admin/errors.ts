import { ApiError } from './api'

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.forbidden) return 'This account does not have admin access.'
  if (error instanceof Error) return error.message
  return String(error)
}
