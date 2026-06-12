/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAgentChatGraphLayout,
  buildAgentChatGraphEdgePath,
  buildAgentChatGraphLaneEdgePath,
  getAgentChatGraphNodeColor,
} from './agent-chat-view-model';
import { AgentChatGraphView } from './agent-chat-graph-view';

const sampleGraph = {
  nodes: [
    {
      id: 'turn-root',
      parentTurnId: null,
      status: 'completed' as const,
      turnType: 'follow_up' as const,
      isSelected: true,
      siblingIndex: 0,
      siblingCount: 1,
      supersedesTurnId: null,
      supersededByTurnId: null,
      userMessageId: 'message-root',
      preview: 'root prompt',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
      completedAt: null,
    },
    {
      id: 'turn-child',
      parentTurnId: 'turn-root',
      status: 'completed' as const,
      turnType: 'follow_up' as const,
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
};

const sampleLayout = buildAgentChatGraphLayout({
  activeAgentId: 'agent-1',
  activeConvId: 'conversation-1',
  canonicalView: {
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    total: 2,
    branches: [],
    entries: [],
    graph: sampleGraph,
  },
});

const laneLayout = buildAgentChatGraphLayout({
  activeAgentId: 'agent-1',
  activeConvId: 'conversation-1',
  style: 'native',
  canonicalView: {
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    total: 2,
    branches: [],
    entries: [],
    graph: sampleGraph,
  },
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('buildAgentChatGraphEdgePath', () => {
  it('uses curved connectors for the dots style', () => {
    const edge = sampleLayout.edges[1];
    expect(buildAgentChatGraphEdgePath(edge)).toMatch(/^M .* C /);
  });
});

describe('buildAgentChatGraphLaneEdgePath', () => {
  it('uses rail connectors for the lane style', () => {
    const edge = laneLayout.edges[1];
    const path = buildAgentChatGraphLaneEdgePath(edge);
    expect(path).toMatch(/^M /);
    expect(path).not.toMatch(/ C /);
  });
});

describe('AgentChatGraphView', () => {
  it('renders dot nodes by default', () => {
    render(<AgentChatGraphView layout={sampleLayout} onNodeSelect={() => {}} />);

    expect(screen.getByTestId('agents-chat-graph-view')).toHaveAttribute(
      'data-chat-graph-style',
      'dots',
    );
    expect(screen.getByTestId('agents-chat-graph-node-turn-root').className).toMatch(/dotsNode/);
  });

  it('renders lane graph nodes when the devtools flag is set', () => {
    window.localStorage.setItem(
      'openwork:feature-flags:v1',
      JSON.stringify({ 'agentChat.graphViewStyle': 'native' }),
    );

    render(<AgentChatGraphView layout={laneLayout} onNodeSelect={() => {}} />);

    expect(screen.getByTestId('agents-chat-graph-view')).toHaveAttribute(
      'data-chat-graph-style',
      'native',
    );
    const rootNode = screen.getByTestId('agents-chat-graph-node-turn-root');
    expect(rootNode.className).toMatch(/laneNode/);
    expect(rootNode).toHaveStyle({
      '--chat-graph-node-color': getAgentChatGraphNodeColor(0),
    });
    expect(screen.queryByText('root prompt')).not.toBeInTheDocument();
  });

  it('calls onNodeSelect when a node is clicked', () => {
    const onNodeSelect = vi.fn();
    render(<AgentChatGraphView layout={laneLayout} style="native" onNodeSelect={onNodeSelect} />);

    fireEvent.click(screen.getByTestId('agents-chat-graph-node-turn-child'));

    expect(onNodeSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'turn-child', userMessageId: 'message-child' }),
    );
  });
});
