import cron from 'node-cron';
import { listAgents, getAgent } from './agents.js';
import { executeCronTask } from './agent-chat.js';

export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  enabled: boolean;
}

interface RunningCronTask {
  task: cron.ScheduledTask;
  signature: string;
}

// Map keyed by `{agentId}:{jobId}` → running scheduled task with job signature
const runningTasks = new Map<string, RunningCronTask>();

function taskKey(agentId: string, jobId: string): string {
  return `${agentId}:${jobId}`;
}

function jobSignature(job: Pick<CronJob, 'cron' | 'prompt'>): string {
  return JSON.stringify({ cron: job.cron, prompt: job.prompt });
}

/**
 * Sync running cron tasks for a specific agent.
 * Stops removed/disabled jobs, starts new/enabled ones.
 */
export function syncAgentCronJobs(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) return;
  const cronJobs: CronJob[] = agent.cronJobs ?? [];

  // Build expected active jobs keyed by task key
  const expectedJobs = new Map<string, { job: CronJob; signature: string }>();
  for (const job of cronJobs) {
    if (!job.enabled) continue;
    if (!cron.validate(job.cron)) continue; // skip invalid
    expectedJobs.set(taskKey(agentId, job.id), { job, signature: jobSignature(job) });
  }

  // Stop tasks that are no longer needed
  for (const [key, running] of runningTasks.entries()) {
    if (!key.startsWith(`${agentId}:`)) continue;
    if (!expectedJobs.has(key)) {
      running.task.stop();
      runningTasks.delete(key);
    }
  }

  // Start new tasks and reload tasks whose cron/prompt changed
  for (const [key, expected] of expectedJobs.entries()) {
    const existing = runningTasks.get(key);
    if (existing && existing.signature === expected.signature) {
      continue; // already running with current config
    }

    if (existing) {
      existing.task.stop();
      runningTasks.delete(key);
    }

    const task = cron.schedule(expected.job.cron, () => {
      executeCronTask(agentId, { id: expected.job.id, prompt: expected.job.prompt });
    });
    runningTasks.set(key, { task, signature: expected.signature });
  }
}

/**
 * Stop all cron jobs for a specific agent (used on agent deletion).
 */
export function stopAllAgentCronJobs(agentId: string): void {
  for (const [key, running] of runningTasks.entries()) {
    if (key.startsWith(`${agentId}:`)) {
      running.task.stop();
      runningTasks.delete(key);
    }
  }
}

/**
 * Initialize cron jobs for all agents on app startup.
 */
export function initAllCronJobs(): void {
  const agents = listAgents();
  for (const agent of agents) {
    const cronJobs = agent.cronJobs;
    if (cronJobs && cronJobs.length > 0) {
      syncAgentCronJobs(agent.id);
    }
  }
}
