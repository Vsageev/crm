// ---------------------------------------------------------------------------
// Email inbound sync — STUBBED (dependencies removed for prototyping)
// imapflow and mailparser have been removed to reduce install size.
// ---------------------------------------------------------------------------

/**
 * Sync new emails from IMAP for a single email account.
 * STUB: logs a warning and returns zero synced messages.
 */
export async function syncEmailAccount(accountId: string): Promise<{ synced: number }> {
  console.log(
    `[email-inbound] Email sync not available (dependencies removed for prototyping). accountId=${accountId}`,
  );
  return { synced: 0 };
}
