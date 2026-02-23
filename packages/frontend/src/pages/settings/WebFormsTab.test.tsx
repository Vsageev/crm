import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api';
import { WebFormsTab } from './WebFormsTab';

vi.mock('../../lib/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public details?: unknown,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    api: vi.fn(),
    ApiError,
  };
});

const mockApi = vi.mocked(api);

describe('WebFormsTab', () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it('renders forms when API payload is missing fields arrays', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/web-forms?')) {
        return {
          total: 1,
          limit: 100,
          offset: 0,
          entries: [
            {
              id: 'form-1',
              name: 'Website Lead Form',
              status: 'active',
              submitButtonText: 'Send',
              successMessage: 'Thanks',
            },
          ],
        };
      }

      if (path === '/pipelines?limit=100' || path === '/users?limit=100') {
        return { entries: [] };
      }

      return { entries: [] };
    });

    render(<WebFormsTab />);

    expect(await screen.findByText('Website Lead Form')).toBeInTheDocument();
    expect(screen.getByText('0 fields')).toBeInTheDocument();
  });

  it('shows a friendly warning when list response shape is invalid', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/web-forms?')) {
        return {
          total: 1,
          entries: null,
        };
      }

      if (path === '/pipelines?limit=100' || path === '/users?limit=100') {
        return { entries: [] };
      }

      return { entries: [] };
    });

    render(<WebFormsTab />);

    expect(
      await screen.findByText('Unexpected response format from server. Some forms may be hidden.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No web forms yet.')).toBeInTheDocument();
  });
});
