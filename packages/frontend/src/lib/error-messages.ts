import { ApiError } from './api';

export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return err.message || 'Invalid credentials';
    if (err.status === 403) return err.message || 'Account is deactivated';
    if (err.status === 409) return err.message || 'Already exists';
    if (err.status === 429) return 'Too many attempts. Please wait and try again.';
    if (err.status >= 500) return 'Server error. Please try again later.';
    return err.message || 'An unexpected error occurred. Please try again.';
  }

  if (
    err instanceof TypeError &&
    err.message.includes('Failed to fetch')
  ) {
    return 'Unable to connect to the server. Check your internet connection.';
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return 'An unexpected error occurred. Please try again.';
}
