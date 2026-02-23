import OpenAI from 'openai';
import { env } from '../config/env.js';
import { store } from '../db/index.js';
import { getAllKBEntries } from './knowledge-base.js';
import { type AIProvider, getAISettings, getProviderRequiredKey } from './ai-settings.js';

let openaiClient: OpenAI | null = null;
let openrouterClient: OpenAI | null = null;

function getAIClient(provider: AIProvider): OpenAI | null {
  if (provider === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) return null;
    if (!openrouterClient) {
      openrouterClient = new OpenAI({
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
      });
    }
    return openrouterClient;
  }

  if (!env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export function isAIConfigured(): boolean {
  const { provider } = getAISettings();
  return provider === 'openrouter' ? !!env.OPENROUTER_API_KEY : !!env.OPENAI_API_KEY;
}

export function getAIModel(): string {
  return getAISettings().model;
}

export function getAIProvider(): AIProvider {
  return getAISettings().provider;
}

export async function suggestReply(conversationId: string): Promise<string> {
  const { provider, model } = getAISettings();
  const client = getAIClient(provider);
  if (!client) {
    throw new Error(
      `AI provider "${provider}" is not configured. Please set ${getProviderRequiredKey(provider)}.`,
    );
  }

  // Fetch conversation
  const conversation = store.getById('conversations', conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Fetch last 20 messages
  const allMessages = store
    .find('messages', (m) => m.conversationId === conversationId)
    .sort(
      (a, b) =>
        new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime(),
    );
  const recentMessages = allMessages.slice(-20);

  // Fetch contact info
  const contact = conversation.contactId
    ? store.getById('contacts', conversation.contactId as string)
    : null;

  // Build KB context (up to 8000 chars)
  const kbEntries = getAllKBEntries();
  let kbContext = '';
  let kbCharBudget = 8000;

  for (const entry of kbEntries) {
    const block = `## ${entry.title}\n${entry.content}\n\n`;
    if (block.length > kbCharBudget) break;
    kbContext += block;
    kbCharBudget -= block.length;
  }

  if (!kbContext.trim()) {
    kbContext = '(No knowledge base entries available)';
  }

  // Build contact info string
  const contactParts: string[] = [];
  if (contact) {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    if (name) contactParts.push(`Name: ${name}`);
    if (contact.email) contactParts.push(`Email: ${contact.email}`);
    if (contact.phone) contactParts.push(`Phone: ${contact.phone}`);
    if (contact.position) contactParts.push(`Position: ${contact.position}`);
  }
  const contactInfo = contactParts.length > 0 ? contactParts.join('\n') : 'Unknown contact';

  const channelType = conversation.channelType as string;

  // System prompt
  const systemPrompt = `You are a helpful customer support agent for a company. Your task is to draft a reply to the customer based on the conversation history and the company knowledge base.

Rules:
- Write in plain text (no markdown formatting)
- Match the language the customer is using
- Be professional, friendly, and helpful
- Use information from the knowledge base when relevant
- Keep the reply concise and to the point
- Do not make up information not in the knowledge base or conversation
- If you don't know the answer, suggest the customer contact support through other channels

Channel: ${channelType}

Contact information:
${contactInfo}

Company Knowledge Base:
${kbContext}`;

  // Build conversation history
  const conversationHistory = recentMessages
    .map((msg) => {
      const role = msg.direction === 'inbound' ? 'Customer' : 'Agent';
      const content = ((msg.content as string) || '').slice(0, 500);
      return `${role}: ${content}`;
    })
    .join('\n');

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: conversationHistory || '(No messages yet — generate an appropriate greeting)' },
    ],
    temperature: 0.7,
    max_tokens: 1000,
  });

  const suggestion = response.choices[0]?.message?.content?.trim();
  if (!suggestion) {
    throw new Error('AI returned an empty response');
  }

  return suggestion;
}
