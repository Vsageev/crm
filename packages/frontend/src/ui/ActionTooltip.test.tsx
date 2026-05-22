/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ReasonedActionButton } from './ActionTooltip';

afterEach(() => {
  cleanup();
});

function requiredNumber(source: string, pattern: RegExp, label: string) {
  const match = source.match(pattern);
  expect(match, `${label} should be present`).not.toBeNull();
  return Number(match?.[1]);
}

describe('ReasonedActionButton', () => {
  it('keeps tooltip layer above anchored overlays', () => {
    const uiPath = path.resolve(process.cwd(), 'packages/frontend/src/ui');
    const tooltipCss = readFileSync(path.join(uiPath, 'Tooltip.module.css'), 'utf8');
    const anchoredOverlaySource = readFileSync(
      path.join(uiPath, 'AnchoredOverlay.tsx'),
      'utf8',
    );

    const tooltipZIndex = requiredNumber(tooltipCss, /\.tip\s*{[^}]*z-index:\s*(\d+)/s, 'tooltip z-index');
    const anchoredOverlayDefaultZIndex = requiredNumber(
      anchoredOverlaySource,
      /zIndex\s*=\s*(\d+)/,
      'AnchoredOverlay default z-index',
    );

    expect(tooltipZIndex).toBeGreaterThan(anchoredOverlayDefaultZIndex);
  });

  it('renders an accessible disabled reason on hover', async () => {
    render(
      <ReasonedActionButton
        disabled
        disabledReason={{ kind: 'missing-selection', message: 'Select at least one card to continue' }}
      >
        Run batch
      </ReasonedActionButton>,
    );

    const trigger = screen.getByRole('button', { name: 'Run batch' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).toHaveAccessibleDescription('Select at least one card to continue');

    fireEvent.mouseEnter(trigger);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Select at least one card to continue');
  });

  it('opens the disabled reason on keyboard focus', async () => {
    render(
      <ReasonedActionButton
        disabled
        disabledReason={{ kind: 'permission', message: 'Ask an admin for permission to delete cards' }}
      >
        Delete
      </ReasonedActionButton>,
    );

    const trigger = screen.getByRole('button', { name: 'Delete' });
    trigger.focus();

    expect(trigger).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Ask an admin for permission to delete cards');
  });

  it('removes the disabled reason and invokes onClick after becoming enabled', async () => {
    const onClick = vi.fn();

    function Harness() {
      const [enabled, setEnabled] = useState(false);
      return (
        <>
          <ReasonedActionButton
            disabled={!enabled}
            disabledReason={{ kind: 'invalid-form', message: 'Enter a card title before creating it' }}
            onClick={onClick}
          >
            Create
          </ReasonedActionButton>
          <button type="button" onClick={() => setEnabled(true)}>
            Add title
          </button>
        </>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create' })).toHaveAccessibleDescription(
      'Enter a card title before creating it',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add title' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).not.toHaveAttribute('aria-disabled');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps aria-disabled actions focusable while blocking clicks', async () => {
    const onClick = vi.fn();

    render(
      <ReasonedActionButton
        disabled
        useAriaDisabled
        disabledReason={{ kind: 'active-operation', message: 'Wait for the current sync to finish' }}
        onClick={onClick}
      >
        Sync
      </ReasonedActionButton>,
    );

    const button = screen.getByRole('button', { name: 'Sync' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Wait for the current sync to finish');

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    button.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Wait for the current sync to finish');
  });
});
