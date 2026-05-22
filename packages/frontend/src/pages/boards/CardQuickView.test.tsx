/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CardQuickView } from './CardQuickView';

vi.mock('../../stores/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CardQuickView disabled comment actions', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('explains why an empty comment cannot be sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/cards/card-1') {
        return jsonResponse({
          id: 'card-1',
          collectionId: 'collection-1',
          name: 'Blocked send card',
          description: null,
          customFields: {},
          assigneeId: null,
          assignee: null,
          position: 0,
          tags: [],
          linkedCards: [],
          boards: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
      }
      if (url === '/api/cards/card-1/comments') return jsonResponse({ entries: [] });
      return jsonResponse({ message: 'Unexpected request' }, { status: 500 });
    }));

    render(
      <MemoryRouter>
        <CardQuickView cardId="card-1" onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Blocked send card')).toBeInTheDocument();
    const sendButton = screen.getByRole('button', { name: 'Send comment' });
    expect(sendButton).toHaveAttribute('aria-disabled', 'true');
    expect(sendButton).toHaveAccessibleDescription('Write a comment or attach an image before sending.');

    fireEvent.mouseEnter(sendButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Write a comment or attach an image before sending.');
  });
});
