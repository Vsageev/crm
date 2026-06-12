import { describe, expect, it } from 'vitest';
import {
  buildAgentChatGraphLayout,
  buildAgentChatGraphNodeHoverLabel,
  buildAgentChatGraphLaneEdgePath,
  getAgentChatGraphNodeColor,
  buildAgentChatRunEventSummary,
  isRunEventDetailExpandable,
  shouldTruncateRunEventDetail,
  buildAgentConversationViewModel,
  type AgentConversationChatTurn,
  type AgentConversationChatView,
} from './agent-chat-view-model';

function canonicalTurn(overrides: Partial<AgentConversationChatTurn>): AgentConversationChatTurn {
  const id = overrides.id ?? 'turn-1';
  const userMessageId = overrides.userMessage?.id ?? `message-${id}`;
  const createdAt = overrides.createdAt ?? '2026-01-01T00:00:00.000Z';
  return {
    id,
    parentTurnId: null,
    status: 'completed',
    turnType: 'follow_up',
    userMessage: {
      id: userMessageId,
      direction: 'outbound',
      type: 'text',
      content: userMessageId,
      status: 'sent',
      metadata: null,
      attachments: null,
      createdAt,
      updatedAt: null,
    },
    assistantMessage: null,
    execution: { queue: null, run: null },
    branch: {
      parentTurnId: null,
      isSelected: true,
      siblingIndex: 0,
      siblingCount: 1,
      siblingIds: [id],
      siblings: [
        {
          turnId: id,
          userMessageId,
          status: 'completed',
          turnType: 'follow_up',
          supersedesTurnId: null,
          isSelected: true,
          createdAt,
        },
      ],
    },
    edit: {
      supersedesTurnId: null,
      supersededByTurnId: null,
      isSuperseded: false,
    },
    availableActions: ['edit_user_message'],
    createdAt,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function canonicalView(entries: AgentConversationChatTurn[]): AgentConversationChatView {
  return {
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    total: entries.length,
    branches: [],
    entries,
  };
}

function buildView(canonical: AgentConversationChatView) {
  return buildAgentConversationViewModel({
    canonicalView: canonical,
    activeAgentId: 'agent-1',
    activeConvId: 'conversation-1',
  });
}

describe('buildAgentConversationViewModel', () => {
  it('renders canonical turn status, queue, run, and branch fields without legacy reconstruction', () => {
    const view = buildView(
      canonicalView([
        canonicalTurn({
          id: 'turn-stopped',
          status: 'stopped',
          userMessage: {
            id: 'message-stopped',
            direction: 'outbound',
            type: 'text',
            content: 'stop this',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: null,
          },
          execution: {
            queue: {
              id: 'queue-stopped',
              turnId: 'turn-stopped',
              status: 'cancelled',
              position: null,
              runId: 'run-stopped',
              errorMessage: 'Cancelled by user',
              attempts: 1,
              maxAttempts: 3,
              nextAttemptAt: null,
              startedAt: '2026-01-01T00:00:01.000Z',
              completedAt: '2026-01-01T00:00:02.000Z',
              usedFallback: false,
              fallbackModel: null,
            },
            run: {
              id: 'run-stopped',
              turnId: 'turn-stopped',
              status: 'error',
              errorMessage: 'Killed by user',
              responseText: null,
              startedAt: '2026-01-01T00:00:01.000Z',
              finishedAt: '2026-01-01T00:00:02.000Z',
              durationMs: 1000,
            },
          },
          availableActions: ['retry', 'switch_branch'],
        }),
        canonicalTurn({
          id: 'turn-edit',
          parentTurnId: 'turn-stopped',
          status: 'processing',
          turnType: 'edit',
          userMessage: {
            id: 'message-edit',
            direction: 'outbound',
            type: 'text',
            content: 'edited follow-up',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:01:00.000Z',
            updatedAt: null,
          },
          execution: {
            queue: {
              id: 'queue-edit',
              turnId: 'turn-edit',
              status: 'processing',
              position: 1,
              runId: 'run-edit',
              errorMessage: null,
              attempts: 1,
              maxAttempts: 3,
              nextAttemptAt: null,
              startedAt: '2026-01-01T00:01:01.000Z',
              completedAt: null,
              usedFallback: false,
              fallbackModel: null,
            },
            run: {
              id: 'run-edit',
              turnId: 'turn-edit',
              status: 'running',
              errorMessage: null,
              responseText: null,
              startedAt: '2026-01-01T00:01:01.000Z',
              finishedAt: null,
              durationMs: null,
            },
          },
          branch: {
            parentTurnId: 'turn-stopped',
            isSelected: true,
            siblingIndex: 1,
            siblingCount: 2,
            siblingIds: ['turn-original', 'turn-edit'],
            siblings: [
              {
                turnId: 'turn-original',
                userMessageId: 'message-original',
                status: 'superseded',
                turnType: 'follow_up',
                supersedesTurnId: null,
                isSelected: false,
                createdAt: '2026-01-01T00:00:30.000Z',
              },
              {
                turnId: 'turn-edit',
                userMessageId: 'message-edit',
                status: 'processing',
                turnType: 'edit',
                supersedesTurnId: 'turn-original',
                isSelected: true,
                createdAt: '2026-01-01T00:01:00.000Z',
              },
            ],
          },
          edit: {
            supersedesTurnId: 'turn-original',
            supersededByTurnId: null,
            isSuperseded: false,
          },
          availableActions: ['edit_user_message', 'stop', 'switch_branch'],
        }),
        canonicalTurn({
          id: 'turn-queued',
          parentTurnId: 'turn-edit',
          status: 'queued',
          userMessage: {
            id: 'message-queued',
            direction: 'outbound',
            type: 'text',
            content: 'queued next',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:02:00.000Z',
            updatedAt: null,
          },
          execution: {
            queue: {
              id: 'queue-queued',
              turnId: 'turn-queued',
              status: 'queued',
              position: 2,
              runId: null,
              errorMessage: null,
              attempts: 0,
              maxAttempts: 3,
              nextAttemptAt: '2026-01-01T00:02:00.000Z',
              startedAt: null,
              completedAt: null,
              usedFallback: false,
              fallbackModel: null,
            },
            run: null,
          },
          availableActions: ['edit_queue_item', 'delete_queue_item'],
        }),
      ]),
    );

    expect(view.visibleMessages.map((message) => message.id)).toEqual([
      'message-stopped',
      'message-edit',
    ]);
    expect(view.visibleMessages.find((message) => message.id === 'message-edit')).toMatchObject({
      turnId: 'turn-edit',
      turnStatus: 'processing',
      turnType: 'edit',
      siblingIds: ['message-original', 'message-edit'],
      siblingTurnIds: ['turn-original', 'turn-edit'],
    });
    expect(view.errorsByMessageId.get('message-stopped')?.[0]).toMatchObject({
      id: 'queue-stopped',
      status: 'cancelled',
      turnId: 'turn-stopped',
      availableActions: ['retry', 'switch_branch'],
    });
    expect(view.queuedQueueItems).toEqual([
      expect.objectContaining({ id: 'queue-queued', turnId: 'turn-queued', queuePosition: 1 }),
    ]);
    expect(view.queuedMessages).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({ id: 'message-queued' }),
        queueItem: expect.objectContaining({
          id: 'queue-queued',
          turnId: 'turn-queued',
          queuePosition: 1,
        }),
        status: 'queued',
      }),
    ]);
    expect(view.effectivePendingBranchExecutionsByMessageId.get('message-queued')).toBeUndefined();
    expect(view.activeConversationRun?.id).toBe('run-edit');
    expect(view.activeProcessingTargetMessageId).toBe('message-edit');
    expect(view.showStreamingBubble).toBe(true);
  });

  it('renumbers visible queued rows from one even when the server payload includes global positions', () => {
    const view = buildView(
      canonicalView([
        canonicalTurn({
          id: 'turn-processing-other-branch',
          status: 'processing',
          execution: {
            queue: {
              id: 'queue-processing-other-branch',
              turnId: 'turn-processing-other-branch',
              status: 'processing',
              position: 1,
              runId: 'run-processing-other-branch',
              errorMessage: null,
              attempts: 1,
              maxAttempts: 3,
              nextAttemptAt: null,
              startedAt: '2026-01-01T00:00:01.000Z',
              completedAt: null,
              usedFallback: false,
              fallbackModel: null,
            },
            run: {
              id: 'run-processing-other-branch',
              turnId: 'turn-processing-other-branch',
              status: 'running',
              errorMessage: null,
              responseText: null,
              startedAt: '2026-01-01T00:00:01.000Z',
              finishedAt: null,
              durationMs: null,
            },
          },
        }),
        canonicalTurn({
          id: 'turn-visible-queued',
          parentTurnId: 'turn-processing-other-branch',
          status: 'queued',
          createdAt: '2026-01-01T00:01:00.000Z',
          userMessage: {
            id: 'message-visible-queued',
            direction: 'outbound',
            type: 'text',
            content: 'visible queued prompt',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:01:00.000Z',
            updatedAt: null,
          },
          execution: {
            queue: {
              id: 'queue-visible-queued',
              turnId: 'turn-visible-queued',
              status: 'queued',
              position: 2,
              runId: null,
              errorMessage: null,
              attempts: 0,
              maxAttempts: 3,
              nextAttemptAt: null,
              startedAt: null,
              completedAt: null,
              usedFallback: false,
              fallbackModel: null,
            },
            run: null,
          },
        }),
      ]),
    );

    expect(view.queuedMessages).toHaveLength(1);
    expect(view.queuedMessages[0].queueItem).toMatchObject({
      id: 'queue-visible-queued',
      queuePosition: 1,
    });
    expect(view.queuedQueueItems[0]).toMatchObject({
      id: 'queue-visible-queued',
      queuePosition: 1,
    });
  });

  it('preserves canonical turn order instead of re-sorting messages by timestamp', () => {
    const view = buildView(
      canonicalView([
        canonicalTurn({
          id: 'turn-first',
          userMessage: {
            id: 'message-first',
            direction: 'outbound',
            type: 'text',
            content: 'server-selected first',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:02:00.000Z',
            updatedAt: null,
          },
          createdAt: '2026-01-01T00:02:00.000Z',
        }),
        canonicalTurn({
          id: 'turn-second',
          parentTurnId: 'turn-first',
          userMessage: {
            id: 'message-second',
            direction: 'outbound',
            type: 'text',
            content: 'server-selected second',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:01:00.000Z',
            updatedAt: null,
          },
          createdAt: '2026-01-01T00:01:00.000Z',
        }),
      ]),
    );

    expect(view.visibleMessages.map((message) => message.id)).toEqual([
      'message-first',
      'message-second',
    ]);
  });

  it('does not render a stale canonical view for a different active conversation', () => {
    const view = buildAgentConversationViewModel({
      canonicalView: {
        agentId: 'agent-1',
        conversationId: 'conversation-old',
        total: 1,
        branches: [],
        entries: [canonicalTurn({ id: 'turn-old' })],
      },
      activeAgentId: 'agent-1',
      activeConvId: 'conversation-1',
    });

    expect(view.visibleMessages).toEqual([]);
    expect(view.showStreamingBubble).toBe(false);
  });

  it('carries canonical assistant run ids for completed chat timelines', () => {
    const view = buildView(
      canonicalView([
        canonicalTurn({
          id: 'turn-completed',
          assistantMessage: {
            id: 'assistant-completed',
            direction: 'inbound',
            type: 'text',
            content: 'Done',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:00:03.000Z',
            updatedAt: null,
          },
          execution: {
            queue: null,
            run: {
              id: 'run-completed',
              turnId: 'turn-completed',
              status: 'completed',
              errorMessage: null,
              responseText: 'Done',
              startedAt: '2026-01-01T00:00:01.000Z',
              finishedAt: '2026-01-01T00:00:03.000Z',
              durationMs: 2000,
            },
          },
        }),
      ]),
    );

    expect(view.visibleMessages.find((message) => message.id === 'assistant-completed')).toMatchObject({
      direction: 'inbound',
      runId: 'run-completed',
    });
  });

  it('renders canonical view without accepting legacy state or optimistic rows', () => {
    const view = buildAgentConversationViewModel({
      canonicalView: canonicalView([canonicalTurn({ id: 'turn-canonical' })]),
      activeAgentId: 'agent-1',
      activeConvId: 'conversation-1',
    });

    expect(view.visibleMessages.map((message) => message.id)).toEqual(['message-turn-canonical']);
    expect(view.queuedQueueItems).toEqual([]);
    expect(view.activeConversationRun).toBeNull();
    expect(view.showStreamingBubble).toBe(false);
  });

  it('uses canonical turn ids as branch targets when sibling turns share a user message', () => {
    const siblings: AgentConversationChatTurn['branch']['siblings'] = [
      {
        turnId: 'turn-1',
        userMessageId: 'message-shared',
        status: 'completed',
        turnType: 'follow_up',
        supersedesTurnId: null,
        isSelected: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        turnId: 'turn-2',
        userMessageId: 'message-shared',
        status: 'completed',
        turnType: 'follow_up',
        supersedesTurnId: null,
        isSelected: false,
        createdAt: '2026-01-01T00:01:00.000Z',
      },
      {
        turnId: 'turn-3',
        userMessageId: 'message-third',
        status: 'completed',
        turnType: 'follow_up',
        supersedesTurnId: null,
        isSelected: true,
        createdAt: '2026-01-01T00:02:00.000Z',
      },
    ];
    const view = buildView(
      canonicalView([
        canonicalTurn({
          id: 'turn-3',
          userMessage: {
            id: 'message-third',
            direction: 'outbound',
            type: 'text',
            content: 'third branch',
            status: 'sent',
            metadata: null,
            attachments: null,
            createdAt: '2026-01-01T00:02:00.000Z',
            updatedAt: null,
          },
          branch: {
            parentTurnId: null,
            isSelected: true,
            siblingIndex: 2,
            siblingCount: 3,
            siblingIds: ['turn-1', 'turn-2', 'turn-3'],
            siblings,
          },
        }),
      ]),
    );

    expect(view.visibleMessages[0]).toMatchObject({
      id: 'message-third',
      siblingIndex: 2,
      siblingCount: 3,
      siblingIds: ['message-shared', 'message-shared', 'message-third'],
      siblingTurnIds: ['turn-1', 'turn-2', 'turn-3'],
    });
  });
});

describe('buildAgentChatGraphLayout', () => {
  it('lays out all canonical graph nodes and ranks newer nodes warmer', () => {
    const layout = buildAgentChatGraphLayout({
      activeAgentId: 'agent-1',
      activeConvId: 'conversation-1',
      canonicalView: {
        ...canonicalView([canonicalTurn({ id: 'turn-root' })]),
        graph: {
          nodes: [
            {
              id: 'turn-root',
              parentTurnId: null,
              status: 'completed',
              turnType: 'follow_up',
              isSelected: true,
              siblingIndex: 0,
              siblingCount: 1,
              supersedesTurnId: null,
              supersededByTurnId: null,
              userMessageId: null,
              preview: 'root prompt',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
            {
              id: 'turn-hidden',
              parentTurnId: 'turn-root',
              status: 'completed',
              turnType: 'follow_up',
              isSelected: false,
              siblingIndex: 0,
              siblingCount: 2,
              supersedesTurnId: null,
              supersededByTurnId: null,
              userMessageId: 'message-hidden',
              preview: 'hidden branch',
              createdAt: '2026-01-01T00:01:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
            {
              id: 'turn-selected',
              parentTurnId: 'turn-root',
              status: 'processing',
              turnType: 'edit',
              isSelected: true,
              siblingIndex: 1,
              siblingCount: 2,
              supersedesTurnId: 'turn-hidden',
              supersededByTurnId: null,
              userMessageId: 'message-selected',
              preview: 'selected branch',
              createdAt: '2026-01-01T00:02:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
          ],
          edges: [
            { id: 'root->turn-root', fromTurnId: null, toTurnId: 'turn-root' },
            { id: 'turn-root->turn-hidden', fromTurnId: 'turn-root', toTurnId: 'turn-hidden' },
            {
              id: 'turn-root->turn-selected',
              fromTurnId: 'turn-root',
              toTurnId: 'turn-selected',
            },
          ],
        },
      },
    });

    expect(layout.nodes.map((node) => node.id)).toEqual([
      'turn-root',
      'turn-hidden',
      'turn-selected',
    ]);
    expect(layout.nodes.find((node) => node.id === 'turn-root')?.depth).toBe(0);
    expect(layout.nodes.find((node) => node.id === 'turn-hidden')?.depth).toBe(1);
    expect(layout.nodes.find((node) => node.id === 'turn-selected')?.newness).toBe(1);
    expect(layout.nodes.find((node) => node.id === 'turn-hidden')?.isSelected).toBe(false);
    expect(layout.nodes.find((node) => node.id === 'turn-selected')?.hoverLabel).toBe(
      'selected branch · 2/2',
    );
    expect(layout.edges).toHaveLength(3);
  });

  it('builds hover labels from previews and branch position', () => {
    expect(
      buildAgentChatGraphNodeHoverLabel({
        preview: 'hello world',
        status: 'completed',
        turnType: 'follow_up',
        siblingIndex: 1,
        siblingCount: 3,
      }),
    ).toBe('hello world · 2/3');
  });

  it('builds orthogonal lane edge paths without curves', () => {
    const layout = buildAgentChatGraphLayout({
      activeAgentId: 'agent-1',
      activeConvId: 'conversation-1',
      style: 'native',
      canonicalView: {
        ...canonicalView([canonicalTurn({ id: 'turn-root' })]),
        graph: {
          nodes: [
            {
              id: 'turn-root',
              parentTurnId: null,
              status: 'completed',
              turnType: 'follow_up',
              isSelected: true,
              siblingIndex: 0,
              siblingCount: 1,
              supersedesTurnId: null,
              supersededByTurnId: null,
              userMessageId: null,
              preview: 'root prompt',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
            {
              id: 'turn-child',
              parentTurnId: 'turn-root',
              status: 'completed',
              turnType: 'follow_up',
              isSelected: true,
              siblingIndex: 0,
              siblingCount: 1,
              supersedesTurnId: null,
              supersededByTurnId: null,
              userMessageId: 'message-child',
              preview: 'child prompt',
              createdAt: '2026-01-01T00:01:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
          ],
          edges: [
            { id: 'root->turn-root', fromTurnId: null, toTurnId: 'turn-root' },
            { id: 'turn-root->turn-child', fromTurnId: 'turn-root', toTurnId: 'turn-child' },
          ],
        },
      },
    });

    expect(layout.kind).toBe('lanes');
    const path = buildAgentChatGraphLaneEdgePath(layout.edges[1]);
    expect(path).toMatch(/^M /);
    expect(path).not.toMatch(/ C /);
  });

  it('keeps the selected branch on the main lane and forks siblings to side lanes', () => {
    const layout = buildAgentChatGraphLayout({
      activeAgentId: 'agent-1',
      activeConvId: 'conversation-1',
      style: 'native',
      canonicalView: {
        ...canonicalView([canonicalTurn({ id: 'turn-root' })]),
        graph: {
          nodes: [
            {
              id: 'turn-root',
              parentTurnId: null,
              status: 'completed',
              turnType: 'follow_up',
              isSelected: true,
              siblingIndex: 0,
              siblingCount: 1,
              supersedesTurnId: null,
              supersededByTurnId: null,
              userMessageId: null,
              preview: 'root prompt',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
            {
              id: 'turn-hidden',
              parentTurnId: 'turn-root',
              status: 'completed',
              turnType: 'follow_up',
              isSelected: false,
              siblingIndex: 0,
              siblingCount: 2,
              supersedesTurnId: null,
              supersededByTurnId: null,
              userMessageId: 'message-hidden',
              preview: 'hidden branch',
              createdAt: '2026-01-01T00:01:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
            {
              id: 'turn-selected',
              parentTurnId: 'turn-root',
              status: 'processing',
              turnType: 'edit',
              isSelected: true,
              siblingIndex: 1,
              siblingCount: 2,
              supersedesTurnId: 'turn-hidden',
              supersededByTurnId: null,
              userMessageId: 'message-selected',
              preview: 'selected branch',
              createdAt: '2026-01-01T00:02:00.000Z',
              updatedAt: null,
              completedAt: null,
            },
          ],
          edges: [
            { id: 'root->turn-root', fromTurnId: null, toTurnId: 'turn-root' },
            { id: 'turn-root->turn-hidden', fromTurnId: 'turn-root', toTurnId: 'turn-hidden' },
            {
              id: 'turn-root->turn-selected',
              fromTurnId: 'turn-root',
              toTurnId: 'turn-selected',
            },
          ],
        },
      },
    });

    expect(layout.nodes.find((node) => node.id === 'turn-root')?.lane).toBe(0);
    expect(layout.nodes.find((node) => node.id === 'turn-selected')?.lane).toBe(0);
    expect(layout.nodes.find((node) => node.id === 'turn-hidden')?.lane).toBeGreaterThan(0);
    expect(layout.nodes.find((node) => node.id === 'turn-root')?.y).toBeLessThan(
      layout.nodes.find((node) => node.id === 'turn-selected')?.y ?? 0,
    );
  });

  it('maps older nodes to cool hues and newer nodes to warm hues', () => {
    const oldest = getAgentChatGraphNodeColor(0);
    const newest = getAgentChatGraphNodeColor(1);

    expect(oldest).toMatch(/hsl\(\s*22\d/);
    expect(newest).toMatch(/hsl\(\s*2\d/);
  });

});

describe('buildAgentChatRunEventSummary', () => {
  it('turns parsed monitor blocks into compact chat status events', () => {
    const summary = buildAgentChatRunEventSummary([
      { type: 'system_init', model: 'gpt-5.3-codex', cwd: '/workspace' },
      { type: 'thinking', content: 'Need to inspect the chat rendering code first.' },
      { type: 'tool_call', toolName: 'rg', input: '{"pattern":"Processing"}' },
      { type: 'tool_result', content: 'AgentsPage.tsx: Processing...' },
      { type: 'assistant_text', content: 'I found the processing bubble and updated it.' },
    ]);

    expect(summary.headline).toBe('Drafting response');
    expect(summary.badgeLabel).toBe('Drafting response');
    expect(summary.preview).toBe('I found the processing bubble and updated it.');
    expect(summary.stats).toEqual({ tools: 1, messages: 1, updates: 5 });
    expect(summary.events.map((event) => event.label)).toEqual([
      'Session started: gpt-5.3-codex',
      'Thinking through next step',
      'Running rg',
      'Reading tool output',
      'Drafting response',
    ]);
  });

  it('keeps the full timeline instead of truncating older run events', () => {
    const summary = buildAgentChatRunEventSummary([
      { type: 'system_init', model: 'gpt-5.3-codex', cwd: '/workspace' },
      { type: 'thinking', content: 'first' },
      { type: 'tool_call', toolName: 'rg', input: 'one' },
      { type: 'tool_result', content: 'two' },
      { type: 'tool_call', toolName: 'sed', input: 'three' },
      { type: 'tool_result', content: 'four' },
      { type: 'assistant_text', content: 'five' },
      { type: 'result', text: 'done', isError: false },
    ]);

    expect(summary.stats.updates).toBe(8);
    expect(summary.events).toHaveLength(8);
    expect(summary.events[0]?.label).toBe('Session started: gpt-5.3-codex');
    expect(summary.events.at(-1)?.label).toBe('Finishing run');
  });

  it('falls back cleanly before the first monitor event arrives', () => {
    const summary = buildAgentChatRunEventSummary(null);

    expect(summary.headline).toBe('Thinking');
    expect(summary.badgeLabel).toBe('Processing...');
    expect(summary.preview).toBeNull();
    expect(summary.events).toEqual([]);
  });

  it('stores full thinking text but truncates it until the row is expanded', () => {
    const longThinking = 'line one\nline two\n' + 'x'.repeat(200);
    const summary = buildAgentChatRunEventSummary([
      { type: 'thinking', content: longThinking },
    ]);
    const detail = summary.events[0]?.detail ?? null;

    expect(detail).toBe(longThinking);
    expect(detail).not.toContain('...');
    expect(isRunEventDetailExpandable('thinking', detail)).toBe(true);
    expect(shouldTruncateRunEventDetail('thinking', detail, false, false)).toBe(true);
    expect(shouldTruncateRunEventDetail('thinking', detail, true, false)).toBe(false);
    expect(shouldTruncateRunEventDetail('thinking', detail, false, true)).toBe(true);
  });

  it('hides the final draft and duplicate result text for completed messages', () => {
    const finalAnswer = 'Here is the completed answer.';
    const summary = buildAgentChatRunEventSummary(
      [
        { type: 'thinking', content: 'Working through the request.' },
        { type: 'assistant_text', content: finalAnswer },
        { type: 'result', text: finalAnswer, isError: false },
      ],
      { hideFinalDraft: true },
    );

    expect(summary.events.map((event) => event.label)).toEqual([
      'Thinking through next step',
      'Finishing run',
    ]);
    expect(summary.events.at(-1)?.detail).toBeNull();
  });

  it('keeps the full drafting response text without truncation', () => {
    const longDraft = 'x'.repeat(240);
    const summary = buildAgentChatRunEventSummary([
      { type: 'assistant_text', content: longDraft },
    ]);

    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]?.detail).toBe(longDraft);
    expect(summary.events[0]?.detail).not.toContain('...');
    expect(summary.preview).toBe(longDraft);
  });

  it('merges consecutive drafting response events into one updating row', () => {
    const summary = buildAgentChatRunEventSummary([
      { type: 'tool_call', toolName: 'rg', input: 'one' },
      { type: 'assistant_text', content: 'Hello' },
      { type: 'assistant_text', content: 'Hello world' },
      { type: 'assistant_text', content: 'Hello world!' },
    ]);

    expect(summary.events.map((event) => event.label)).toEqual([
      'Running rg',
      'Drafting response',
    ]);
    expect(summary.events[1]?.detail).toBe('Hello world!');
    expect(summary.stats.updates).toBe(2);
    expect(summary.stats.messages).toBe(3);
  });

  it('prefers spaced draft text over a whitespace-collapsed duplicate chunk', () => {
    const summary = buildAgentChatRunEventSummary([
      {
        type: 'assistant_text',
        content:
          'Redesigningthepathrowsintoasinglefield-stylecontrolthatmatchesothersettingsinputs,withTooltipsinsteadofnativetitles.',
      },
      {
        type: 'assistant_text',
        content:
          'Redesigning the path rows into a single field-style control that matches other settings inputs, with Tooltips instead of native titles.',
      },
    ]);

    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]?.detail).toBe(
      'Redesigning the path rows into a single field-style control that matches other settings inputs, with Tooltips instead of native titles.',
    );
  });

  it('merges markdown link chunks without losing spaces around the link', () => {
    const summary = buildAgentChatRunEventSummary([
      { type: 'assistant_text', content: 'Open [the settings file](/Users/demo/settings.ts)' },
      {
        type: 'assistant_text',
        content: 'Open [the settings file](/Users/demo/settings.ts) in Finder.',
      },
    ]);

    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]?.detail).toBe(
      'Open [the settings file](/Users/demo/settings.ts) in Finder.',
    );
  });

  it('inserts a space when joining unrelated draft chunks', () => {
    const summary = buildAgentChatRunEventSummary([
      { type: 'assistant_text', content: 'First sentence.' },
      { type: 'assistant_text', content: 'Second sentence.' },
    ]);

    expect(summary.events[0]?.detail).toBe('First sentence. Second sentence.');
  });
});
