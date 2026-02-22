import { eventBus, type CrmEventName, type CrmEventMap } from './event-bus.js';
import { getActiveRulesByTrigger } from './automation-rules.js';
import { executeAction } from './action-executors.js';

// ---------------------------------------------------------------------------
// Condition evaluator
// ---------------------------------------------------------------------------

interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

/**
 * Resolve a dotted field path from a flat or nested object.
 * e.g. "contact.source" → payload.contact.source
 */
function resolveField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(condition: Condition, payload: Record<string, unknown>): boolean {
  const actual = resolveField(payload, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'equals':
    case 'eq':
      return String(actual) === String(expected);

    case 'not_equals':
    case 'neq':
      return String(actual) !== String(expected);

    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : false;

    case 'not_contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? !actual.toLowerCase().includes(expected.toLowerCase())
        : true;

    case 'starts_with':
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().startsWith(expected.toLowerCase())
        : false;

    case 'ends_with':
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().endsWith(expected.toLowerCase())
        : false;

    case 'gt':
      return Number(actual) > Number(expected);

    case 'gte':
      return Number(actual) >= Number(expected);

    case 'lt':
      return Number(actual) < Number(expected);

    case 'lte':
      return Number(actual) <= Number(expected);

    case 'in':
      if (Array.isArray(expected)) {
        return expected.map(String).includes(String(actual));
      }
      return false;

    case 'not_in':
      if (Array.isArray(expected)) {
        return !expected.map(String).includes(String(actual));
      }
      return true;

    case 'exists':
      return actual != null && actual !== '';

    case 'not_exists':
      return actual == null || actual === '';

    default:
      return false;
  }
}

/**
 * Evaluate all conditions (AND logic). An empty conditions array = always true.
 */
export function evaluateConditions(
  conditions: unknown[],
  payload: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((c) => {
    const condition = c as Condition;
    if (!condition.field || !condition.operator) return true;
    return evaluateCondition(condition, payload);
  });
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

export interface MatchedRule {
  id: string;
  name: string;
  action: string;
  actionParams: Record<string, unknown>;
}

/**
 * Find all active automation rules whose trigger and conditions match the event.
 * Rules are returned in priority order (from the DB query).
 */
export async function findMatchingRules(
  trigger: CrmEventName,
  payload: Record<string, unknown>,
): Promise<MatchedRule[]> {
  const rules = await getActiveRulesByTrigger(trigger);
  const matched: MatchedRule[] = [];

  for (const rule of rules) {
    const conditions = (rule.conditions ?? []) as unknown[];
    if (evaluateConditions(conditions, payload)) {
      matched.push({
        id: rule.id as string,
        name: rule.name as string,
        action: rule.action as string,
        actionParams: (rule.actionParams ?? {}) as Record<string, unknown>,
      });
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Trigger handler — runs when any CRM event fires
// ---------------------------------------------------------------------------

async function handleTrigger<K extends CrmEventName>(
  trigger: K,
  payload: CrmEventMap[K],
) {
  try {
    const matched = await findMatchingRules(trigger, payload as unknown as Record<string, unknown>);

    if (matched.length === 0) return;

    for (const rule of matched) {
      console.log(
        `[automation] Rule "${rule.name}" (${rule.id}) matched trigger "${trigger}" → action "${rule.action}"`,
      );
      await executeAction(rule, payload as unknown as Record<string, unknown>);
    }
  } catch (err) {
    // Automation failures must never break the main request flow
    console.error(`[automation] Error processing trigger "${trigger}":`, err);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — subscribe to all trigger events
// ---------------------------------------------------------------------------

const TRIGGERS: CrmEventName[] = [
  'contact_created',
  'deal_created',
  'deal_stage_changed',
  'message_received',
  'tag_added',
  'task_completed',
  'conversation_created',
];

let initialized = false;

/**
 * Register event-bus listeners for every automation trigger type.
 * Safe to call multiple times — only registers once.
 */
export function initAutomationEngine() {
  if (initialized) return;
  initialized = true;

  for (const trigger of TRIGGERS) {
    eventBus.on(trigger, (payload) => {
      // Fire-and-forget: automation processing must not block the emitter
      handleTrigger(trigger, payload).catch((err) => {
        console.error(`[automation] Unhandled error for trigger "${trigger}":`, err);
      });
    });
  }

  console.log('[automation] Engine initialized — listening for triggers');
}
