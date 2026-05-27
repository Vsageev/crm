import type postgres from 'postgres';

export type AgentManualRepairEvidence = {
  source: 'card' | 'comment';
  cardId: string;
  cardName: string;
  commentId: string | null;
  matchedBy: string[];
};

export type AgentEvidenceTarget = {
  agentId: string;
  name: string;
};

type CardEvidenceRow = {
  cardId: string;
  cardName: string;
  description: string | null;
  customFields: Record<string, unknown> | null;
};

type CommentEvidenceRow = {
  commentId: string;
  cardId: string;
  cardName: string;
  content: string;
};

const MANUAL_REPAIR_PATTERNS = [
  { key: 'manual_repair', pattern: /\bmanual[- ]repair\b/i },
  { key: 'blocked', pattern: /\bblocked\b/i },
  { key: 'repair_required', pattern: /\brepair[- ]required\b/i },
  { key: 'legacy_import_required', pattern: /\blegacy_import_required\b/i },
  { key: 'runner_validation', pattern: /\brunner[- ]validation\b/i },
  { key: 'validate_repository_root', pattern: /validate-repository-root/i },
  { key: 'import_legacy', pattern: /files\/import-legacy/i },
  { key: 'repository_roots_report', pattern: /repository-roots:report/i },
  { key: 'agent_inventory_report', pattern: /agent-inventory:report/i },
];

function normalizeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function evidenceKeys(text: string): string[] {
  return MANUAL_REPAIR_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ key }) => key);
}

function mentionsAgent(text: string, agent: AgentEvidenceTarget): boolean {
  return text.toLowerCase().includes(agent.agentId.toLowerCase());
}

function matchEvidence(
  text: string,
  agent: AgentEvidenceTarget,
): string[] {
  if (!mentionsAgent(text, agent)) return [];
  return evidenceKeys(text);
}

export async function loadManualRepairEvidenceByAgent(
  sql: postgres.Sql,
  agents: AgentEvidenceTarget[],
): Promise<Map<string, AgentManualRepairEvidence[]>> {
  const evidence = new Map<string, AgentManualRepairEvidence[]>();
  if (agents.length === 0) return evidence;

  const cards = await sql<CardEvidenceRow[]>`
    select
      id as "cardId",
      name as "cardName",
      description,
      custom_fields as "customFields"
    from cards
  `;
  const comments = await sql<CommentEvidenceRow[]>`
    select
      cc.id as "commentId",
      cc.card_id as "cardId",
      c.name as "cardName",
      cc.content
    from card_comments cc
    join cards c on c.id = cc.card_id
  `;

  for (const agent of agents) {
    for (const card of cards) {
      const text = `${card.cardName}\n${card.description ?? ''}\n${normalizeText(card.customFields)}`;
      const matchedBy = matchEvidence(text, agent);
      if (matchedBy.length > 0) {
        const existing = evidence.get(agent.agentId) ?? [];
        existing.push({
          source: 'card',
          cardId: card.cardId,
          cardName: card.cardName,
          commentId: null,
          matchedBy,
        });
        evidence.set(agent.agentId, existing);
      }
    }

    for (const comment of comments) {
      const matchedBy = matchEvidence(comment.content, agent);
      if (matchedBy.length > 0) {
        const existing = evidence.get(agent.agentId) ?? [];
        existing.push({
          source: 'comment',
          cardId: comment.cardId,
          cardName: comment.cardName,
          commentId: comment.commentId,
          matchedBy,
        });
        evidence.set(agent.agentId, existing);
      }
    }
  }

  return evidence;
}
