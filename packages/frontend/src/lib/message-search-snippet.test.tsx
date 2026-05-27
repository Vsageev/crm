/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MessageSearchSnippet,
  renderMessageSearchSnippetForStyle,
  type MessageSearchSnippetData,
} from './message-search-snippet';

const sample: MessageSearchSnippetData = {
  snippet: 'hello world',
  matchStart: 6,
  matchLength: 5,
  direction: 'outbound',
  agentName: 'Codex',
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('renderMessageSearchSnippetForStyle', () => {
  it('renders inline-text with a sender separator', () => {
    render(renderMessageSearchSnippetForStyle(sample, 'inline-text'));

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('world')).toHaveProperty('tagName', 'MARK');
  });

  it('renders inbox-prefix labels', () => {
    render(renderMessageSearchSnippetForStyle(sample, 'inbox-prefix'));

    expect(screen.getByText('You:')).toBeInTheDocument();
  });

  it('renders badge labels', () => {
    render(renderMessageSearchSnippetForStyle(sample, 'badge'));

    expect(screen.getByText('You')).toHaveClass(/badgeUser/);
  });

  it('renders accent-bar without a text label', () => {
    const { container } = render(renderMessageSearchSnippetForStyle(sample, 'accent-bar'));

    expect(container.querySelector('[class*="accentBarUser"]')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('renders role-dot labels for agent messages', () => {
    render(
      renderMessageSearchSnippetForStyle(
        { ...sample, direction: 'inbound', agentName: 'Research Bot' },
        'role-dot',
      ),
    );

    expect(screen.getByText('Research Bot')).toBeInTheDocument();
  });
});

describe('MessageSearchSnippet', () => {
  it('reads the devtools feature flag', () => {
    window.localStorage.setItem(
      'openwork:feature-flags:v1',
      JSON.stringify({ 'agentChat.messageSearchSenderStyle': 'badge' }),
    );

    render(<MessageSearchSnippet data={sample} />);

    expect(screen.getByText('You')).toHaveClass(/badgeUser/);
  });
});
