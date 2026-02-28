# Flow: Draft a Proposal

**Triggers:** "create/draft/write a proposal", "send a proposal to <contact>"

## Steps

1. **Identify the contact** — find the conversation by contact name via `GET /api/conversations`
2. **Gather context** — fetch related cards, tasks, and company info via the API
3. **Compose the message** — include:
   - Board overview (card names, values, columns, expected dates)
   - Completed cards if any
   - Recommended next steps
   - Total board value
4. **Save as draft** — use the message drafts API (`PUT /api/message-drafts`) in the contact's conversation
5. **Confirm** — tell the user the draft is ready for review in the inbox

## Rules

- Always create a **draft**, never send directly unless explicitly asked
- Always use the API agent for data and delivery
- Keep the proposal concise and scannable (use bullet points, not paragraphs)
