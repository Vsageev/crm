/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';

const register = vi.fn();

vi.mock('../../stores/useAuth', () => ({
  useAuth: () => ({ register }),
}));

describe('RegisterPage password policy', () => {
  afterEach(() => {
    cleanup();
    register.mockReset();
  });

  it('shows aligned requirements and blocks submit for weak passwords', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'weakpass' },
    });

    expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
    expect(screen.queryByText(/special character/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'weakpass' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).not.toHaveBeenCalled();
    expect(screen.getByText('Password must contain at least one uppercase letter')).toBeInTheDocument();
  });
});
