import {
  buildAgentChatGraphEdgePath,
  buildAgentChatGraphLaneEdgePath,
  getAgentChatGraphNodeColor,
  type AgentChatGraphLayout,
  type AgentChatGraphLayoutNode,
} from './agent-chat-view-model';
import {
  useFeatureFlags,
  type AgentChatGraphViewStyle,
} from '../devtools/feature-flags';
import { Tooltip } from '../ui/Tooltip';
import styles from './agent-chat-graph-view.module.css';

function AgentChatGraphDotsNode({
  node,
  onSelect,
}: {
  node: AgentChatGraphLayoutNode;
  onSelect: (node: AgentChatGraphLayoutNode) => void;
}) {
  const isActive = node.status === 'processing';
  const isSelected = node.isSelected;

  return (
    <button
      type="button"
      className={`${styles.dotsNode} ${isSelected ? styles.dotsNodeSelected : ''} ${
        isActive ? styles.dotsNodeActive : ''
      }`}
      style={{
        ['--chat-graph-node-color' as string]: getAgentChatGraphNodeColor(node.newness),
      }}
      aria-label={node.hoverLabel}
      data-testid={`agents-chat-graph-node-${node.id}`}
      onClick={() => onSelect(node)}
    />
  );
}

function AgentChatGraphLaneNode({
  node,
  onSelect,
}: {
  node: AgentChatGraphLayoutNode;
  onSelect: (node: AgentChatGraphLayoutNode) => void;
}) {
  const isActive = node.status === 'processing';
  const isSelected = node.isSelected;

  return (
    <button
      type="button"
      className={`${styles.laneNode} ${isSelected ? styles.laneNodeSelected : ''} ${
        isActive ? styles.laneNodeActive : ''
      }`}
      style={{
        ['--chat-graph-node-color' as string]: getAgentChatGraphNodeColor(node.newness),
      }}
      aria-label={node.hoverLabel}
      data-testid={`agents-chat-graph-node-${node.id}`}
      onClick={() => onSelect(node)}
    />
  );
}

function AgentChatGraphDotsCanvas({
  layout,
  onNodeSelect,
}: {
  layout: AgentChatGraphLayout;
  onNodeSelect: (node: AgentChatGraphLayoutNode) => void;
}) {
  return (
    <div className={styles.area} data-testid="agents-chat-graph-view" data-chat-graph-style="dots">
      <div className={styles.viewport}>
        <div className={styles.canvas} style={{ width: layout.width, height: layout.height }}>
          <svg
            className={styles.edges}
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => {
              const onSelectedBranch =
                edge.from?.isSelected === true && edge.to.isSelected === true;
              return (
                <path
                  key={edge.id}
                  className={`${styles.edge} ${onSelectedBranch ? styles.edgeSelected : ''}`}
                  d={buildAgentChatGraphEdgePath(edge)}
                />
              );
            })}
          </svg>
          {layout.nodes.map((node) => (
            <div
              key={node.id}
              className={styles.nodeWrap}
              style={{ left: node.x, top: node.y }}
            >
              <Tooltip label={node.hoverLabel} position="top">
                <AgentChatGraphDotsNode node={node} onSelect={onNodeSelect} />
              </Tooltip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentChatGraphLaneCanvas({
  layout,
  onNodeSelect,
}: {
  layout: AgentChatGraphLayout;
  onNodeSelect: (node: AgentChatGraphLayoutNode) => void;
}) {
  return (
    <div className={styles.area} data-testid="agents-chat-graph-view" data-chat-graph-style="native">
      <div className={styles.viewport}>
        <div
          className={styles.laneCanvas}
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            className={styles.laneEdges}
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => {
              const onSelectedBranch =
                edge.from?.isSelected === true && edge.to.isSelected === true;
              return (
                <path
                  key={edge.id}
                  className={`${styles.laneEdge} ${onSelectedBranch ? styles.laneEdgeSelected : ''}`}
                  d={buildAgentChatGraphLaneEdgePath(edge)}
                />
              );
            })}
          </svg>
          {layout.nodes.map((node) => (
            <div
              key={node.id}
              className={styles.laneNodeWrap}
              style={{ left: node.x, top: node.y }}
            >
              <Tooltip label={node.hoverLabel} position="right">
                <AgentChatGraphLaneNode node={node} onSelect={onNodeSelect} />
              </Tooltip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgentChatGraphView({
  layout,
  style,
  onNodeSelect,
}: {
  layout: AgentChatGraphLayout;
  style?: AgentChatGraphViewStyle;
  onNodeSelect: (node: AgentChatGraphLayoutNode) => void;
}) {
  const { flags } = useFeatureFlags();
  const graphStyle = style ?? flags['agentChat.graphViewStyle'];

  if (layout.nodes.length === 0) {
    return (
      <div
        className={styles.empty}
        data-testid="agents-chat-graph-view"
        data-chat-graph-style={graphStyle}
      >
        No branches yet
      </div>
    );
  }

  if (graphStyle === 'native' || layout.kind === 'lanes') {
    return <AgentChatGraphLaneCanvas layout={layout} onNodeSelect={onNodeSelect} />;
  }

  return <AgentChatGraphDotsCanvas layout={layout} onNodeSelect={onNodeSelect} />;
}
