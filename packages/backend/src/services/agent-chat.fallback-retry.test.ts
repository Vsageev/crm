import { beforeEach, describe, expect, it, vi } from 'vitest';

const turnMocks = vi.hoisted(() => ({
  getAgentChatTurn: vi.fn(),
  markAgentChatTurnRunning: vi.fn(() => ({ id: 'turn-1', status: 'running' })),
}));

vi.mock('./agent-chat-turns.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-chat-turns.js')>();
  return {
    ...actual,
    getAgentChatTurn: turnMocks.getAgentChatTurn,
    markAgentChatTurnRunning: turnMocks.markAgentChatTurnRunning,
  };
});

import { __agentChatTestUtils } from './agent-chat.js';

describe('prepareChatTurnForFallbackRetry', () => {
  beforeEach(() => {
    turnMocks.getAgentChatTurn.mockReset();
    turnMocks.markAgentChatTurnRunning.mockClear();
  });

  it('reopens a failed turn so the fallback run can start', () => {
    turnMocks.getAgentChatTurn.mockReturnValue({
      id: 'turn-1',
      status: 'failed',
    });

    __agentChatTestUtils.prepareChatTurnForFallbackRetry('turn-1');

    expect(turnMocks.markAgentChatTurnRunning).toHaveBeenCalledWith('turn-1');
  });

  it('does not touch turns that are already running', () => {
    turnMocks.getAgentChatTurn.mockReturnValue({
      id: 'turn-1',
      status: 'running',
    });

    __agentChatTestUtils.prepareChatTurnForFallbackRetry('turn-1');

    expect(turnMocks.markAgentChatTurnRunning).not.toHaveBeenCalled();
  });
});
