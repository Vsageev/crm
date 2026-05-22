/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevtoolsMenu } from './DevtoolsMenu';
import { isDevtoolsEnabledFromEnv } from './feature-flags';

describe('DevtoolsMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('is hidden when the env-gated widget is disabled', () => {
    render(<DevtoolsMenu enabled={false} />);

    expect(screen.queryByRole('button', { name: 'Open devtools' })).not.toBeInTheDocument();
  });

  it('switches and persists the devtools design variant flag', () => {
    render(<DevtoolsMenu enabled />);

    const trigger = screen.getByRole('button', { name: 'Open devtools' });
    expect(trigger.closest('[data-devtools-design-variant]')).toHaveAttribute(
      'data-devtools-design-variant',
      'floating',
    );

    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Devtools design variant'), {
      target: { value: 'dock' },
    });

    expect(trigger.closest('[data-devtools-design-variant]')).toHaveAttribute(
      'data-devtools-design-variant',
      'dock',
    );
    expect(window.localStorage.getItem('openwork:feature-flags:v1')).toContain(
      '"devtools.designVariant":"dock"',
    );
  });

  it('persists execution plan experiment boolean flags', () => {
    render(<DevtoolsMenu enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Open devtools' }));
    fireEvent.click(screen.getByLabelText('Board → plan drag'));

    expect(window.localStorage.getItem('openwork:feature-flags:v1')).toContain(
      '"executionPlans.boardDragIn":true',
    );
  });

  it('does not expose alternate plans panel layouts', () => {
    render(<DevtoolsMenu enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Open devtools' }));

    expect(screen.queryByLabelText('Plans panel layout')).not.toBeInTheDocument();
  });

  it('does not expose alternate plans editor modes', () => {
    render(<DevtoolsMenu enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Open devtools' }));

    expect(screen.queryByLabelText('Plans editor mode')).not.toBeInTheDocument();
  });

  it('parses common enabled env values only', () => {
    expect(isDevtoolsEnabledFromEnv('true')).toBe(true);
    expect(isDevtoolsEnabledFromEnv('1')).toBe(true);
    expect(isDevtoolsEnabledFromEnv('yes')).toBe(true);
    expect(isDevtoolsEnabledFromEnv('false')).toBe(false);
    expect(isDevtoolsEnabledFromEnv(undefined)).toBe(false);
  });
});
