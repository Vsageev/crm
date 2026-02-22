import { store } from '../db/index.js';

/**
 * Get all active agent user IDs, sorted by ID for stable ordering.
 */
export async function getActiveAgentIds(): Promise<string[]> {
  const agents = store
    .find('users', (r) => r.isActive === true)
    .sort((a, b) => (a.id as string).localeCompare(b.id as string));

  return agents.map((a) => a.id as string);
}

/**
 * Determine the next agent to assign via round-robin.
 *
 * @param ruleId  - The automation rule triggering the assignment
 * @param agentIds - Ordered list of agent IDs to rotate through.
 *                   If empty, falls back to all active users.
 * @returns The selected agent ID, or null if no agents available.
 */
export async function getNextRoundRobinAgent(
  ruleId: string,
  agentIds?: string[],
): Promise<string | null> {
  // Resolve the pool of eligible agents
  let pool = agentIds && agentIds.length > 0 ? agentIds : await getActiveAgentIds();

  if (pool.length === 0) return null;

  // Filter out inactive users from the explicit pool
  if (agentIds && agentIds.length > 0) {
    const activeUsers = store.find('users', (r) => r.isActive === true);
    const activeSet = new Set(activeUsers.map((u) => u.id as string));
    pool = pool.filter((id) => activeSet.has(id));
    if (pool.length === 0) return null;
  }

  // Fetch current state
  const state = store.findOne('roundRobinState', (r) => r.ruleId === ruleId);

  const lastIndex = (state?.lastIndex as number) ?? -1;
  const nextIndex = (lastIndex + 1) % pool.length;
  const selectedAgentId = pool[nextIndex];

  // Upsert the state
  if (state) {
    store.update('roundRobinState', state.id as string, {
      lastIndex: nextIndex,
      lastAssignedAgentId: selectedAgentId,
    });
  } else {
    store.insert('roundRobinState', {
      ruleId,
      lastIndex: nextIndex,
      lastAssignedAgentId: selectedAgentId,
    });
  }

  return selectedAgentId;
}
