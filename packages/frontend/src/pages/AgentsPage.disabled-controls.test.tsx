/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyComposer } from './AgentsPage';

const noopAsync = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('ReplyComposer disabled control reasons', () => {
  it('sends staged image attachments while a run is streaming so they can queue', async () => {
    const onSendAttachments = vi.fn(async () => {});
    const createObjectURL = vi.fn(() => 'blob:preview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { container } = render(
      <ReplyComposer
        streaming
        autoAttachOversizedPasteAsTextFile
        onSendAttachments={onSendAttachments}
        onSendText={noopAsync}
      />,
    );

    expect(screen.getByRole('button', { name: 'Attach images' })).not.toBeDisabled();

    const imageInput = container.querySelector<HTMLInputElement>('input[accept="image/*"]');
    expect(imageInput).not.toBeNull();
    const image = new File(['fake image'], 'queued-photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(imageInput!, { target: { files: [image] } });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(onSendAttachments).toHaveBeenCalledWith('', [image]);
    });
  });

  it('explains missing runner configuration on the send button', async () => {
    render(
      <ReplyComposer
        streaming={false}
        disabledReason="Connect an OpenWork runner before sending messages"
        autoAttachOversizedPasteAsTextFile
        onSendAttachments={noopAsync}
        onSendText={noopAsync}
      />,
    );

    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toHaveAccessibleDescription('Connect an OpenWork runner before sending messages');

    fireEvent.mouseEnter(send);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Connect an OpenWork runner before sending messages',
    );
  });

  it('explains busy edit state on the cancel button', async () => {
    render(
      <ReplyComposer
        streaming={false}
        autoAttachOversizedPasteAsTextFile
        onSendAttachments={noopAsync}
        onSendText={noopAsync}
        editingMessage={{
          kind: 'message',
          agentId: 'agent-1',
          conversationId: 'conversation-1',
          id: 'message-1',
          initialValue: 'Original prompt',
          value: 'Updated prompt',
          existingAttachments: [],
          isSubmitting: true,
          onChange: vi.fn(),
          onCancel: vi.fn(),
          onSubmit: noopAsync,
        }}
      />,
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAccessibleDescription('Wait for the edit to finish saving');

    cancel.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Wait for the edit to finish saving',
    );
  });
});
