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

  it('parses common enabled env values only', () => {
    expect(isDevtoolsEnabledFromEnv('true')).toBe(true);
    expect(isDevtoolsEnabledFromEnv('1')).toBe(true);
    expect(isDevtoolsEnabledFromEnv('yes')).toBe(true);
    expect(isDevtoolsEnabledFromEnv('false')).toBe(false);
    expect(isDevtoolsEnabledFromEnv(undefined)).toBe(false);
  });
});
