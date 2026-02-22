// ---------------------------------------------------------------------------
// Email outbound — STUBBED (nodemailer removed for prototyping)
// ---------------------------------------------------------------------------

import { store } from '../db/index.js';
import { updateMessageStatus } from './messages.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendEmailMessageParams {
  conversationId: string;
  messageId: string;
  text: string;
  subject?: string;
}

export interface SendEmailMessageResult {
  ok: boolean;
  emailMessageId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Send email via SMTP — STUB
// ---------------------------------------------------------------------------

/**
 * Send an email message via SMTP.
 * STUB: logs the attempt and marks the message as sent without actually sending.
 */
export async function sendEmailMessage(
  params: SendEmailMessageParams,
): Promise<SendEmailMessageResult> {
  console.log(
    `[email-outbound] Email sending not available (dependencies removed for prototyping). messageId=${params.messageId}`,
  );

  const conversation = store.getById('conversations', params.conversationId);

  if (!conversation || conversation.channelType !== 'email') {
    await updateMessageStatus(params.messageId, 'failed');
    return { ok: false, error: 'Not an email conversation or no active email account' };
  }

  // Mark as sent so the UI flow doesn't break
  const fakeMessageId = `stub-${Date.now()}@localhost`;
  store.update('messages', params.messageId, {
    externalId: fakeMessageId,
    status: 'sent',
    updatedAt: new Date(),
  });

  return { ok: true, emailMessageId: fakeMessageId };
}
