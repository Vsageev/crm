import type { OutputBlock } from 'shared';

export interface AgentChatAttachment {
  type: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
}

export interface AgentChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
  type?: string;
  metadata?: string | null;
  attachments?: AgentChatAttachment[] | null;
  parentId?: string | null;
  previousUserMessageId?: string | null;
  runId?: string | null;
  siblingIndex?: number;
  siblingCount?: number;
  siblingIds?: string[];
  siblingTurnIds?: string[];
  turnId?: string | null;
  turnStatus?: AgentConversationChatTurn['status'];
  turnType?: AgentConversationChatTurn['turnType'];
  availableActions?: AgentConversationChatTurn['availableActions'];
  supersedesTurnId?: string | null;
  supersededByTurnId?: string | null;
  isSupersededTurn?: boolean;
}

export interface AgentChatQueueItem {
  id: string;
  agentId: string;
  conversationId: string;
  mode?: 'append_prompt' | 'respond_to_message';
  prompt: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  createdAt: string;
  updatedAt?: string;
  targetMessageId?: string | null;
  queuedMessageId?: string | null;
  previousUserMessageId?: string | null;
  attachments?: AgentChatAttachment[] | null;
  runId?: string | null;
  errorMessage?: string | null;
  turnId?: string | null;
  turnStatus?: AgentConversationChatTurn['status'];
  availableActions?: AgentConversationChatTurn['availableActions'];
  queuePosition?: number | null;
}

export interface AgentConversationRunSummary {
  id: string;
  agentId?: string;
  conversationId?: string | null;
  responseParentId?: string | null;
  status: 'running' | 'completed' | 'error';
  startedAt: string;
}

export type QueueExecutionMode = NonNullable<AgentChatQueueItem['mode']>;

export interface BuildAgentConversationViewModelOptions {
  canonicalView?: AgentConversationChatView | null;
  activeAgentId: string | null;
  activeConvId: string | null;
}

export interface AgentConversationViewModel {
  visibleMessages: AgentChatMessage[];
  queuedQueueItems: AgentChatQueueItem[];
  queuedMessages: {
    message: AgentChatMessage;
    status: 'queued' | 'processing';
    queueItem: AgentChatQueueItem | null;
  }[];
  notifyQueueItems: AgentChatQueueItem[];
  effectivePendingBranchExecutionsByMessageId: Map<string, AgentChatQueueItem[]>;
  errorsByMessageId: Map<string, AgentChatQueueItem[]>;
  orphanErrorItems: AgentChatQueueItem[];
  activeConversationRun: AgentConversationRunSummary | null;
  activeProcessingTargetMessageId: string | null;
  showStreamingBubble: boolean;
}

export type AgentConversationChatTurnStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'superseded';

export type AgentConversationChatTurnAction =
  | 'edit_user_message'
  | 'edit_queue_item'
  | 'delete_queue_item'
  | 'retry'
  | 'stop'
  | 'switch_branch';

export interface AgentConversationChatViewMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  status: string | null;
  metadata?: string | Record<string, unknown> | null;
  attachments: unknown;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AgentConversationChatViewQueue {
  id: string;
  turnId?: string;
  status: string;
  position?: number | null;
  runId: string | null;
  errorMessage: string | null;
  attempts: number | null;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  usedFallback: boolean;
  fallbackModel: string | null;
}

export interface AgentConversationChatViewRun {
  id: string;
  turnId?: string | null;
  status: string;
  errorMessage: string | null;
  responseText: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface AgentConversationChatTurnSibling {
  turnId: string;
  userMessageId: string | null;
  status: AgentConversationChatTurnStatus;
  turnType: string;
  supersedesTurnId: string | null;
  isSelected: boolean;
  createdAt: string | null;
}

export interface AgentConversationChatViewDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  turnId: string | null;
  field: string | null;
  referencedId: string | null;
}

export interface AgentConversationChatTurn {
  id: string;
  parentTurnId: string | null;
  status: AgentConversationChatTurnStatus;
  turnType: string;
  userMessage: AgentConversationChatViewMessage | null;
  assistantMessage: AgentConversationChatViewMessage | null;
  execution: {
    queue: AgentConversationChatViewQueue | null;
    run: AgentConversationChatViewRun | null;
  };
  branch: {
    parentTurnId: string | null;
    isSelected: boolean;
    siblingIndex: number;
    siblingCount: number;
    siblingIds: string[];
    siblings: AgentConversationChatTurnSibling[];
  };
  edit: {
    supersedesTurnId: string | null;
    supersededByTurnId: string | null;
    isSuperseded: boolean;
  };
  availableActions: AgentConversationChatTurnAction[];
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentConversationChatGraphNode {
  id: string;
  parentTurnId: string | null;
  status: AgentConversationChatTurnStatus;
  turnType: string;
  isSelected: boolean;
  siblingIndex: number;
  siblingCount: number;
  supersedesTurnId: string | null;
  supersededByTurnId: string | null;
  userMessageId: string | null;
  preview: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface AgentConversationChatGraphEdge {
  id: string;
  fromTurnId: string | null;
  toTurnId: string;
}

export interface AgentConversationChatView {
  conversationId: string;
  agentId: string;
  total: number;
  entries: AgentConversationChatTurn[];
  branches: Array<{
    parentTurnId: string | null;
    selectedTurnId: string | null;
    turnIds: string[];
  }>;
  graph?: {
    nodes: AgentConversationChatGraphNode[];
    edges: AgentConversationChatGraphEdge[];
  };
}

export interface AgentChatRunEvent {
  id: string;
  kind: OutputBlock['type'];
  label: string;
  detail: string | null;
}

export const RUN_EVENT_DETAIL_PREVIEW_MAX = 120;

const RUN_EVENT_EXPANDABLE_KINDS = new Set<OutputBlock['type']>([
  'thinking',
  'plain_text',
  'tool_result',
  'tool_call',
  'result',
]);

export interface AgentChatRunEventSummary {
  headline: string;
  badgeLabel: string;
  preview: string | null;
  events: AgentChatRunEvent[];
  stats: {
    tools: number;
    messages: number;
    updates: number;
  };
}

export function toQueueCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export interface AgentChatGraphLayoutNode extends AgentConversationChatGraphNode {
  depth: number;
  row: number;
  lane: number;
  x: number;
  y: number;
  newness: number;
  hoverLabel: string;
}

export interface AgentChatGraphLayoutEdge extends AgentConversationChatGraphEdge {
  from: AgentChatGraphLayoutNode | null;
  to: AgentChatGraphLayoutNode;
}

export type AgentChatGraphLayoutKind = 'spatial' | 'lanes';

export interface AgentChatGraphLayout {
  kind: AgentChatGraphLayoutKind;
  nodes: AgentChatGraphLayoutNode[];
  edges: AgentChatGraphLayoutEdge[];
  width: number;
  height: number;
}

export const AGENT_CHAT_GRAPH_NODE_RADIUS = 6;

const GRAPH_COLUMN_GAP = 128;
const GRAPH_ROW_GAP = 80;
const GRAPH_MARGIN = 48;
const GRAPH_NODE_DIAMETER = AGENT_CHAT_GRAPH_NODE_RADIUS * 2;

const LANE_WIDTH = 56;
const LANE_ROW_HEIGHT = 72;
const LANE_MARGIN = 40;

export function buildAgentChatGraphLayout(options: {
  canonicalView?: AgentConversationChatView | null;
  activeAgentId: string | null;
  activeConvId: string | null;
  style?: 'dots' | 'native';
}): AgentChatGraphLayout {
  const graphContext = resolveAgentChatGraphContext(options);
  if (!graphContext) return emptyAgentChatGraphLayout('spatial');

  if (options.style === 'native') {
    return buildAgentChatGraphLaneLayout(graphContext);
  }

  return buildAgentChatGraphSpatialLayout(graphContext);
}

function resolveAgentChatGraphContext(options: {
  canonicalView?: AgentConversationChatView | null;
  activeAgentId: string | null;
  activeConvId: string | null;
}):
  | {
      canonicalView: AgentConversationChatView;
      baseNodes: AgentConversationChatGraphNode[];
      depthById: Map<string, number>;
      newnessById: Map<string, number>;
    }
  | null {
  const { canonicalView } = options;
  if (!canonicalView) return null;
  if (
    (options.activeAgentId && canonicalView.agentId !== options.activeAgentId) ||
    (options.activeConvId && canonicalView.conversationId !== options.activeConvId)
  ) {
    return null;
  }

  const baseNodes = getCanonicalGraphNodes(canonicalView);
  if (baseNodes.length === 0) return null;

  const byId = new Map(baseNodes.map((node) => [node.id, node]));
  const depthById = new Map<string, number>();
  const getDepth = (node: AgentConversationChatGraphNode, visiting = new Set<string>()): number => {
    const cached = depthById.get(node.id);
    if (cached !== undefined) return cached;
    if (!node.parentTurnId || !byId.has(node.parentTurnId) || visiting.has(node.id)) {
      depthById.set(node.id, 0);
      return 0;
    }
    visiting.add(node.id);
    const parent = byId.get(node.parentTurnId);
    const depth = parent ? getDepth(parent, visiting) + 1 : 0;
    visiting.delete(node.id);
    depthById.set(node.id, depth);
    return depth;
  };

  for (const node of baseNodes) {
    getDepth(node);
  }

  const sortedByAge = [...baseNodes].sort(compareGraphNodeAge);
  const newnessById = new Map<string, number>();
  sortedByAge.forEach((node, index) => {
    newnessById.set(node.id, sortedByAge.length <= 1 ? 1 : index / (sortedByAge.length - 1));
  });

  return { canonicalView, baseNodes, depthById, newnessById };
}

function buildAgentChatGraphSpatialLayout(graphContext: {
  canonicalView: AgentConversationChatView;
  baseNodes: AgentConversationChatGraphNode[];
  depthById: Map<string, number>;
  newnessById: Map<string, number>;
}): AgentChatGraphLayout {
  const { canonicalView, baseNodes, depthById, newnessById } = graphContext;
  const nodesByDepth = new Map<number, AgentConversationChatGraphNode[]>();
  for (const node of baseNodes) {
    const depth = depthById.get(node.id) ?? 0;
    nodesByDepth.set(depth, [...(nodesByDepth.get(depth) ?? []), node]);
  }

  const layoutNodes: AgentChatGraphLayoutNode[] = [];
  for (const [depth, nodesAtDepth] of [...nodesByDepth.entries()].sort((a, b) => a[0] - b[0])) {
    nodesAtDepth.sort(compareGraphNodeWithinDepth);
    nodesAtDepth.forEach((node, row) => {
      layoutNodes.push({
        ...node,
        depth,
        row,
        lane: 0,
        x: GRAPH_MARGIN + depth * GRAPH_COLUMN_GAP,
        y: GRAPH_MARGIN + row * GRAPH_ROW_GAP,
        newness: newnessById.get(node.id) ?? 0,
        userMessageId: node.userMessageId ?? null,
        preview: node.preview ?? null,
        hoverLabel: buildAgentChatGraphNodeHoverLabel(node),
      });
    });
  }

  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]));
  const baseEdges = getCanonicalGraphEdges(canonicalView, baseNodes);
  const edges = baseEdges
    .map((edge): AgentChatGraphLayoutEdge | null => {
      const to = layoutById.get(edge.toTurnId);
      if (!to) return null;
      return {
        ...edge,
        from: edge.fromTurnId ? (layoutById.get(edge.fromTurnId) ?? null) : null,
        to,
      };
    })
    .filter((edge): edge is AgentChatGraphLayoutEdge => edge !== null);

  const maxDepth = Math.max(...layoutNodes.map((node) => node.depth));
  const maxRows = Math.max(
    ...[...nodesByDepth.values()].map((nodesAtDepth) => nodesAtDepth.length),
  );

  return {
    kind: 'spatial',
    nodes: layoutNodes.sort(compareGraphNodePosition),
    edges,
    width: Math.max(280, GRAPH_MARGIN * 2 + maxDepth * GRAPH_COLUMN_GAP + GRAPH_NODE_DIAMETER),
    height: Math.max(
      200,
      GRAPH_MARGIN * 2 + (maxRows - 1) * GRAPH_ROW_GAP + GRAPH_NODE_DIAMETER,
    ),
  };
}

function buildAgentChatGraphLaneLayout(graphContext: {
  canonicalView: AgentConversationChatView;
  baseNodes: AgentConversationChatGraphNode[];
  depthById: Map<string, number>;
  newnessById: Map<string, number>;
}): AgentChatGraphLayout {
  const { canonicalView, baseNodes, depthById, newnessById } = graphContext;
  const childrenByParent = new Map<string, AgentConversationChatGraphNode[]>();
  for (const node of baseNodes) {
    if (!node.parentTurnId) continue;
    childrenByParent.set(node.parentTurnId, [
      ...(childrenByParent.get(node.parentTurnId) ?? []),
      node,
    ]);
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareGraphNodeWithinDepth);
  }

  const laneById = new Map<string, number>();
  let maxLane = 0;

  const assignLane = (nodeId: string, lane: number) => {
    laneById.set(nodeId, lane);
    maxLane = Math.max(maxLane, lane);
    const children = childrenByParent.get(nodeId) ?? [];
    const selectedChild = children.find((child) => child.isSelected);
    const offPathChildren = children.filter((child) => !child.isSelected);

    if (selectedChild) {
      assignLane(selectedChild.id, lane);
    }

    let nextLane = maxLane + 1;
    for (const child of offPathChildren) {
      assignLane(child.id, nextLane);
      nextLane = maxLane + 1;
    }
  };

  const roots = baseNodes
    .filter((node) => (depthById.get(node.id) ?? 0) === 0)
    .sort(compareGraphNodeWithinDepth);
  roots.forEach((root, index) => {
    assignLane(root.id, index === 0 ? 0 : maxLane + 1);
  });

  const layoutNodes: AgentChatGraphLayoutNode[] = baseNodes.map((node) => {
    const depth = depthById.get(node.id) ?? 0;
    const lane = laneById.get(node.id) ?? 0;
    return {
      ...node,
      depth,
      row: 0,
      lane,
      x: LANE_MARGIN + lane * LANE_WIDTH + LANE_WIDTH / 2,
      y: LANE_MARGIN + depth * LANE_ROW_HEIGHT,
      newness: newnessById.get(node.id) ?? 0,
      userMessageId: node.userMessageId ?? null,
      preview: node.preview ?? null,
      hoverLabel: buildAgentChatGraphNodeHoverLabel(node),
    };
  });

  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]));
  const baseEdges = getCanonicalGraphEdges(canonicalView, baseNodes);
  const edges = baseEdges
    .map((edge): AgentChatGraphLayoutEdge | null => {
      const to = layoutById.get(edge.toTurnId);
      if (!to) return null;
      return {
        ...edge,
        from: edge.fromTurnId ? (layoutById.get(edge.fromTurnId) ?? null) : null,
        to,
      };
    })
    .filter((edge): edge is AgentChatGraphLayoutEdge => edge !== null);

  const maxDepth = Math.max(...layoutNodes.map((node) => node.depth));

  return {
    kind: 'lanes',
    nodes: layoutNodes.sort(compareGraphNodeLanePosition),
    edges,
    width: Math.max(220, LANE_MARGIN * 2 + maxLane * LANE_WIDTH + LANE_WIDTH / 2),
    height: Math.max(160, LANE_MARGIN * 2 + maxDepth * LANE_ROW_HEIGHT + 12),
  };
}

function emptyAgentChatGraphLayout(kind: AgentChatGraphLayoutKind): AgentChatGraphLayout {
  return { kind, nodes: [], edges: [], width: 280, height: 200 };
}

export function buildAgentChatGraphNodePreviewLabel(
  node: Pick<AgentConversationChatGraphNode, 'preview' | 'status' | 'turnType'>,
): string {
  if (node.preview) return node.preview;
  if (node.status === 'queued') return 'Queued';
  if (node.status === 'processing') return 'Processing';
  if (node.turnType === 'edit') return 'Edited branch';
  return 'Message';
}

export function buildAgentChatGraphNodeHoverLabel(
  node: Pick<
    AgentConversationChatGraphNode,
    'preview' | 'status' | 'turnType' | 'siblingIndex' | 'siblingCount'
  >,
): string {
  const branchHint =
    node.siblingCount > 1 ? ` · ${node.siblingIndex + 1}/${node.siblingCount}` : '';
  return `${buildAgentChatGraphNodePreviewLabel(node)}${branchHint}`;
}

/** Older nodes are cooler (blue); newer nodes are warmer (orange). */
export function getAgentChatGraphNodeColor(newness: number): string {
  const t = Math.max(0, Math.min(1, newness));
  const hue = 220 - t * 196;
  const saturation = 48 + t * 40;
  const lightness = 66 - t * 14;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function buildAgentChatGraphCurvePath(options: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  nodeRadius: number;
}): string {
  const { fromX, fromY, toX, toY, nodeRadius } = options;
  const x1 = fromX + nodeRadius;
  const y1 = fromY;
  const x2 = toX - nodeRadius;
  const y2 = toY;
  const midX = Math.max(x1 + 16, (x1 + x2) / 2);
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

export function buildAgentChatGraphEdgePath(edge: AgentChatGraphLayoutEdge): string {
  const nodeRadius = AGENT_CHAT_GRAPH_NODE_RADIUS;
  const fromX = edge.from ? edge.from.x : edge.to.x - nodeRadius * 3;
  const fromY = edge.from ? edge.from.y : edge.to.y;
  return buildAgentChatGraphCurvePath({
    fromX,
    fromY,
    toX: edge.to.x,
    toY: edge.to.y,
    nodeRadius,
  });
}

export function buildAgentChatGraphLaneEdgePath(edge: AgentChatGraphLayoutEdge): string {
  const toX = edge.to.x;
  const toY = edge.to.y;
  const fromX = edge.from?.x ?? toX;
  const fromY = edge.from?.y ?? toY - LANE_ROW_HEIGHT * 0.45;
  const fromLane = edge.from?.lane ?? edge.to.lane;
  const toLane = edge.to.lane;

  if (fromLane === toLane) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  const forkY = fromY + Math.max(18, (toY - fromY) * 0.45);
  return `M ${fromX} ${fromY} L ${fromX} ${forkY} L ${toX} ${forkY} L ${toX} ${toY}`;
}

function getCanonicalGraphNodes(
  view: AgentConversationChatView,
): AgentConversationChatGraphNode[] {
  if (view.graph?.nodes?.length) return view.graph.nodes;
  const nodes = new Map<string, AgentConversationChatGraphNode>();
  for (const turn of view.entries) {
    nodes.set(turn.id, {
      id: turn.id,
      parentTurnId: turn.parentTurnId,
      status: turn.status,
      turnType: turn.turnType,
      isSelected: true,
      siblingIndex: turn.branch.siblingIndex,
      siblingCount: turn.branch.siblingCount,
      supersedesTurnId: turn.edit.supersedesTurnId,
      supersededByTurnId: turn.edit.supersededByTurnId,
      userMessageId: turn.userMessage?.id ?? null,
      preview: summarizeRunEventPreview(turn.userMessage?.content ?? null),
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
      completedAt: turn.completedAt,
    });
    for (const sibling of turn.branch.siblings) {
      if (nodes.has(sibling.turnId)) continue;
      nodes.set(sibling.turnId, {
        id: sibling.turnId,
        parentTurnId: turn.branch.parentTurnId,
        status: sibling.status,
        turnType: sibling.turnType,
        isSelected: sibling.isSelected,
        siblingIndex: turn.branch.siblingIds.indexOf(sibling.turnId),
        siblingCount: turn.branch.siblingCount,
        supersedesTurnId: sibling.supersedesTurnId,
        supersededByTurnId: null,
        userMessageId: null,
        preview: null,
        createdAt: sibling.createdAt,
        updatedAt: null,
        completedAt: null,
      });
    }
  }
  return [...nodes.values()];
}

function getCanonicalGraphEdges(
  view: AgentConversationChatView,
  nodes: AgentConversationChatGraphNode[],
): AgentConversationChatGraphEdge[] {
  if (view.graph?.edges?.length) return view.graph.edges;
  return nodes.map((node) => ({
    id: `${node.parentTurnId ?? 'root'}->${node.id}`,
    fromTurnId: node.parentTurnId,
    toTurnId: node.id,
  }));
}

function compareGraphNodeAge(
  a: Pick<AgentConversationChatGraphNode, 'createdAt' | 'id'>,
  b: Pick<AgentConversationChatGraphNode, 'createdAt' | 'id'>,
): number {
  const createdAtDelta = parseDateMs(a.createdAt) - parseDateMs(b.createdAt);
  if (createdAtDelta !== 0) return createdAtDelta;
  return a.id.localeCompare(b.id);
}

function compareGraphNodePosition(
  a: Pick<AgentChatGraphLayoutNode, 'depth' | 'createdAt' | 'siblingIndex' | 'id'>,
  b: Pick<AgentChatGraphLayoutNode, 'depth' | 'createdAt' | 'siblingIndex' | 'id'>,
): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  return compareGraphNodeWithinDepth(a, b);
}

function compareGraphNodeLanePosition(
  a: Pick<AgentChatGraphLayoutNode, 'depth' | 'lane' | 'createdAt' | 'siblingIndex' | 'id'>,
  b: Pick<AgentChatGraphLayoutNode, 'depth' | 'lane' | 'createdAt' | 'siblingIndex' | 'id'>,
): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.lane !== b.lane) return a.lane - b.lane;
  return compareGraphNodeWithinDepth(a, b);
}

function compareGraphNodeWithinDepth(
  a: Pick<AgentConversationChatGraphNode, 'createdAt' | 'siblingIndex' | 'id'>,
  b: Pick<AgentConversationChatGraphNode, 'createdAt' | 'siblingIndex' | 'id'>,
): number {
  if (a.siblingIndex !== b.siblingIndex) return a.siblingIndex - b.siblingIndex;
  return compareGraphNodeAge(a, b);
}

function parseDateMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAttachmentRecords(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (typeof raw === 'string') {
    try {
      return parseAttachmentRecords(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (!isRecord(raw)) return [];
  if (Array.isArray(raw.attachments)) return parseAttachmentRecords(raw.attachments);
  if (typeof raw.storagePath === 'string' || typeof raw.fileName === 'string') return [raw];
  return Object.values(raw).filter(isRecord);
}

function getAttachmentFileSize(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getAttachmentFileName(record: Record<string, unknown>, storagePath: string): string {
  if (typeof record.fileName === 'string' && record.fileName.trim()) return record.fileName;
  const pathName = storagePath.split('/').filter(Boolean).pop();
  return pathName || 'Attachment';
}

export function normalizeAgentChatAttachments(raw: unknown): AgentChatAttachment[] | null {
  const attachments = parseAttachmentRecords(raw)
    .map((record): AgentChatAttachment | null => {
      const storagePath =
        typeof record.storagePath === 'string'
          ? record.storagePath
          : typeof record.path === 'string'
            ? record.path
            : '';
      if (!storagePath) return null;
      const type = record.type === 'image' ? 'image' : 'file';
      return {
        type,
        fileName: getAttachmentFileName(record, storagePath),
        mimeType:
          typeof record.mimeType === 'string' && record.mimeType
            ? record.mimeType
            : type === 'image'
              ? 'image/*'
              : 'application/octet-stream',
        fileSize: getAttachmentFileSize(record.fileSize),
        storagePath,
      };
    })
    .filter((attachment): attachment is AgentChatAttachment => attachment !== null);
  return attachments.length > 0 ? attachments : null;
}

export function queueItemsLabel(count: number): string {
  return `${count} message${count === 1 ? '' : 's'} queued`;
}

export function getQueueItemMode(item: Pick<AgentChatQueueItem, 'mode'>): QueueExecutionMode {
  return item.mode ?? 'append_prompt';
}

export interface BuildAgentChatRunEventSummaryOptions {
  /** Hide the final draft row when the assistant bubble already shows the answer. */
  hideFinalDraft?: boolean;
}

export function buildAgentChatRunEventSummary(
  blocks: OutputBlock[] | null | undefined,
  options: BuildAgentChatRunEventSummaryOptions = {},
): AgentChatRunEventSummary {
  const normalizedBlocks = collapseConsecutiveAssistantTextBlocks(blocks ?? []);
  const rawEvents = normalizedBlocks
    .map((block, index) => mapOutputBlockToRunEvent(block, index))
    .filter((event): event is AgentChatRunEvent => event !== null);
  const events = prepareRunEventsForDisplay(
    collapseConsecutiveDraftRunEvents(rawEvents),
    options,
  );
  const latest = events.length > 0 ? events[events.length - 1] : null;
  const latestPreview = findLatestRunEventPreview(normalizedBlocks);
  const toolCount = (blocks ?? []).filter((block) => block.type === 'tool_call').length;
  const messageCount = (blocks ?? []).filter((block) => block.type === 'assistant_text').length;

  return {
    headline: latest?.label ?? 'Thinking',
    badgeLabel: latest ? latest.label : 'Processing...',
    preview: latestPreview,
    events,
    stats: {
      tools: toolCount,
      messages: messageCount,
      updates: events.length,
    },
  };
}

function mapOutputBlockToRunEvent(block: OutputBlock, index: number): AgentChatRunEvent | null {
  const id = `${block.type}:${index}`;
  if (block.type === 'system_init') {
    return {
      id,
      kind: block.type,
      label: block.model ? `Session started: ${block.model}` : 'Session started',
      detail: block.cwd ?? null,
    };
  }
  if (block.type === 'thinking') {
    return {
      id,
      kind: block.type,
      label: 'Thinking through next step',
      detail: formatRunEventDetailText(block.content),
    };
  }
  if (block.type === 'assistant_text') {
    return {
      id: `assistant_text:draft:${index}`,
      kind: block.type,
      label: 'Drafting response',
      detail: formatRunEventDraftText(block.content),
    };
  }
  if (block.type === 'tool_call') {
    return {
      id,
      kind: block.type,
      label: `Running ${block.toolName}`,
      detail: formatRunEventDetailText(block.input ?? null),
    };
  }
  if (block.type === 'tool_result') {
    return {
      id,
      kind: block.type,
      label: 'Reading tool output',
      detail: formatRunEventDetailText(block.content),
    };
  }
  if (block.type === 'result') {
    return {
      id,
      kind: block.type,
      label: block.isError ? 'Run hit an error' : 'Finishing run',
      detail: formatRunEventDetailText(block.text ?? block.stopReason ?? null),
    };
  }
  if (block.type === 'rate_limit') {
    return {
      id,
      kind: block.type,
      label: 'Rate limited',
      detail: block.retryAfter ? `Retrying in ${block.retryAfter}s` : (block.message ?? null),
    };
  }
  if (block.type === 'message_meta') {
    const details = Object.entries(block.details)
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    return {
      id,
      kind: block.type,
      label: block.label,
      detail: details || null,
    };
  }
  if (block.type === 'plain_text') {
    return {
      id,
      kind: block.type,
      label: 'Streaming output',
      detail: formatRunEventDetailText(block.content),
    };
  }
  return null;
}

function collapseConsecutiveAssistantTextBlocks(blocks: OutputBlock[]): OutputBlock[] {
  const collapsed: OutputBlock[] = [];

  for (const block of blocks) {
    const previous = collapsed[collapsed.length - 1];
    if (block.type === 'assistant_text' && previous?.type === 'assistant_text') {
      collapsed[collapsed.length - 1] = {
        type: 'assistant_text',
        content: mergeAssistantTextContent(previous.content, block.content),
      };
      continue;
    }
    collapsed.push(block);
  }

  return collapsed;
}

function mergeAssistantTextContent(current: string, incoming: string): string {
  return mergeRunEventDraftDetails(current, incoming) ?? '';
}

function collapseConsecutiveDraftRunEvents(events: AgentChatRunEvent[]): AgentChatRunEvent[] {
  const collapsed: AgentChatRunEvent[] = [];

  for (const event of events) {
    const previous = collapsed[collapsed.length - 1];
    if (event.kind === 'assistant_text' && previous?.kind === 'assistant_text') {
      collapsed[collapsed.length - 1] = {
        ...previous,
        id: previous.id,
        detail: mergeRunEventDraftDetails(previous.detail, event.detail),
      };
      continue;
    }
    collapsed.push(event);
  }

  return collapsed;
}

function normalizeDraftTextForCompare(text: string): string {
  return text.replace(/\s+/g, '');
}

function findDraftTextSuffixPrefixOverlap(previous: string, next: string): number {
  const max = Math.min(previous.length, next.length);
  for (let size = max; size > 0; size -= 1) {
    if (previous.endsWith(next.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

function joinDraftTextSegments(previous: string, next: string): string {
  const overlap = findDraftTextSuffixPrefixOverlap(previous, next);
  if (overlap > 0) {
    return previous + next.slice(overlap);
  }
  const needsSpace =
    previous.length > 0 &&
    next.length > 0 &&
    !/\s/.test(previous.at(-1) ?? '') &&
    !/\s/.test(next[0] ?? '');
  return needsSpace ? `${previous} ${next}` : `${previous}${next}`;
}

function mergeRunEventDraftDetails(
  current: string | null,
  incoming: string | null,
): string | null {
  const next = formatRunEventDraftText(incoming);
  if (!next) return current;
  const previous = current?.trim() ? current : null;
  if (!previous) return next;
  if (next === previous) return previous;
  if (next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;

  const prevCmp = normalizeDraftTextForCompare(previous);
  const nextCmp = normalizeDraftTextForCompare(next);
  if (nextCmp.startsWith(prevCmp)) return next;
  if (prevCmp.startsWith(nextCmp)) return previous;
  if (prevCmp === nextCmp) {
    return next.length >= previous.length ? next : previous;
  }

  return joinDraftTextSegments(previous, next);
}

function formatRunEventDraftText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function findLatestRunEventPreview(blocks: OutputBlock[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.type === 'assistant_text') {
      const preview = formatRunEventDraftText(block.content);
      if (preview) return preview;
    }
    if (block.type === 'thinking' || block.type === 'plain_text') {
      const preview = summarizeRunEventText(block.content, 220);
      if (preview) return preview;
    }
    if (block.type === 'tool_result') {
      const preview = summarizeRunEventText(block.content, 220);
      if (preview) return preview;
    }
  }
  return null;
}

export function formatRunEventDetailText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.replace(/\r\n/g, '\n').trim();
  return text ? text : null;
}

export function isRunEventDetailExpandable(
  kind: OutputBlock['type'],
  detail: string | null,
): boolean {
  if (!detail || kind === 'assistant_text' || !RUN_EVENT_EXPANDABLE_KINDS.has(kind)) {
    return false;
  }
  return detail.length > 80 || detail.includes('\n');
}

/** @deprecated Use isRunEventDetailExpandable + shouldTruncateRunEventDetail */
export function shouldOfferRunEventDetailExpand(
  kind: OutputBlock['type'],
  detail: string | null,
  compact: boolean,
): boolean {
  return isRunEventDetailExpandable(kind, detail) && compact;
}

export function shouldTruncateRunEventDetail(
  kind: OutputBlock['type'],
  detail: string | null,
  detailExpanded: boolean,
  compact: boolean,
): boolean {
  if (!isRunEventDetailExpandable(kind, detail)) return false;
  if (compact) return true;
  return !detailExpanded;
}

export function summarizeRunEventPreview(
  value: string | null | undefined,
  maxLength = RUN_EVENT_DETAIL_PREVIEW_MAX,
): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function summarizeRunEventText(
  value: string | null | undefined,
  maxLength = RUN_EVENT_DETAIL_PREVIEW_MAX,
): string | null {
  return summarizeRunEventPreview(value, maxLength);
}

function normalizeRunEventComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function runEventTextsMatch(left: string, right: string): boolean {
  return normalizeRunEventComparableText(left) === normalizeRunEventComparableText(right);
}

function prepareRunEventsForDisplay(
  events: AgentChatRunEvent[],
  options: BuildAgentChatRunEventSummaryOptions,
): AgentChatRunEvent[] {
  let displayEvents = events;
  let hiddenFinalDraftDetail: string | null = null;

  if (options.hideFinalDraft) {
    let lastDraftIndex = -1;
    for (let index = displayEvents.length - 1; index >= 0; index -= 1) {
      if (displayEvents[index]?.kind === 'assistant_text') {
        lastDraftIndex = index;
        break;
      }
    }
    if (lastDraftIndex >= 0) {
      hiddenFinalDraftDetail = displayEvents[lastDraftIndex]?.detail ?? null;
      displayEvents = displayEvents.filter((_, index) => index !== lastDraftIndex);
    }
  }

  const lastEvent = displayEvents[displayEvents.length - 1];
  if (lastEvent?.kind !== 'result' || !lastEvent.detail) {
    return displayEvents;
  }

  const matchingTextEvent = [...displayEvents]
    .slice(0, -1)
    .reverse()
    .find((event) => event.kind === 'assistant_text' || event.kind === 'plain_text');
  const duplicatesHiddenDraft =
    hiddenFinalDraftDetail != null &&
    runEventTextsMatch(hiddenFinalDraftDetail, lastEvent.detail);
  const duplicatesVisibleText =
    matchingTextEvent?.detail != null &&
    runEventTextsMatch(matchingTextEvent.detail, lastEvent.detail);
  if (duplicatesHiddenDraft || duplicatesVisibleText) {
    return displayEvents.map((event, index) =>
      index === displayEvents.length - 1 ? { ...event, detail: null } : event,
    );
  }

  return displayEvents;
}

export function getBranchTargetIdByOffset(
  ids: string[] | undefined,
  index: number | undefined,
  offset: number,
): string | null {
  const idx = index ?? 0;
  const branchIds = ids ?? [];
  const targetIdx = idx + offset;
  if (targetIdx < 0 || targetIdx >= branchIds.length) return null;
  return branchIds[targetIdx] ?? null;
}

function compareByCreatedAt(
  a: Pick<AgentChatMessage, 'createdAt' | 'id'>,
  b: Pick<AgentChatMessage, 'createdAt' | 'id'>,
): number {
  const createdAtDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdAtDelta !== 0) return createdAtDelta;
  return a.id.localeCompare(b.id);
}

export function buildAgentConversationViewModel(
  options: BuildAgentConversationViewModelOptions,
): AgentConversationViewModel {
  return buildCanonicalAgentConversationViewModel(options);
}

function buildCanonicalAgentConversationViewModel(
  options: BuildAgentConversationViewModelOptions,
): AgentConversationViewModel {
  const { canonicalView } = options;
  if (!canonicalView) return emptyAgentConversationViewModel();
  if (
    (options.activeAgentId && canonicalView.agentId !== options.activeAgentId) ||
    (options.activeConvId && canonicalView.conversationId !== options.activeConvId)
  ) {
    return emptyAgentConversationViewModel();
  }

  const visibleMessages: AgentChatMessage[] = [];
  const queuedQueueItems: AgentChatQueueItem[] = [];
  const queuedMessages: AgentConversationViewModel['queuedMessages'] = [];
  const notifyQueueItems: AgentChatQueueItem[] = [];
  const errorsByMessageId = new Map<string, AgentChatQueueItem[]>();
  const orphanErrorItems: AgentChatQueueItem[] = [];
  const effectivePendingBranchExecutionsByMessageId = new Map<string, AgentChatQueueItem[]>();
  let activeConversationRun: AgentConversationRunSummary | null = null;
  let activeProcessingTargetMessageId: string | null = null;

  for (const turn of canonicalView.entries) {
    const queueItem = mapCanonicalQueueItem(canonicalView, turn);
    const userMessage = mapCanonicalMessage(turn.userMessage, turn);
    const assistantMessage = mapCanonicalMessage(turn.assistantMessage, turn);

    if (turn.status === 'queued' && userMessage) {
      if (queueItem) queuedQueueItems.push(queueItem);
      queuedMessages.push({
        message: userMessage,
        status: queueItem?.status === 'processing' ? 'processing' : 'queued',
        queueItem,
      });
      continue;
    }

    if (userMessage) {
      visibleMessages.push(userMessage);
    }

    if (turn.status === 'processing') {
      activeProcessingTargetMessageId = activeProcessingTargetMessageId ?? userMessage?.id ?? null;
      if (queueItem) {
        effectivePendingBranchExecutionsByMessageId.set(userMessage?.id ?? turn.id, [queueItem]);
      }
      const run = mapCanonicalRun(turn);
      if (run && !activeConversationRun) {
        activeConversationRun = run;
        activeProcessingTargetMessageId = userMessage?.id ?? null;
      }
    }

    if (assistantMessage) {
      visibleMessages.push(assistantMessage);
    }

    if (turn.status === 'failed' || turn.status === 'stopped') {
      const noticeItem = queueItem ?? mapCanonicalNoticeItem(canonicalView, turn);
      notifyQueueItems.push(noticeItem);
      if (userMessage) {
        errorsByMessageId.set(userMessage.id, [
          ...(errorsByMessageId.get(userMessage.id) ?? []),
          noticeItem,
        ]);
      } else {
        orphanErrorItems.push(noticeItem);
      }
    }
  }

  queuedQueueItems.sort((a, b) =>
    compareByCreatedAt(queueItemToComparable(a), queueItemToComparable(b)),
  );
  queuedMessages.sort((a, b) => compareByCreatedAt(a.message, b.message));
  const visibleQueuePositionById = new Map<string, number>();
  queuedMessages.forEach((queuedMessage, index) => {
    if (!queuedMessage.queueItem) return;
    const queuePosition = index + 1;
    queuedMessage.queueItem = { ...queuedMessage.queueItem, queuePosition };
    visibleQueuePositionById.set(queuedMessage.queueItem.id, queuePosition);
  });
  const displayQueuedQueueItems = queuedQueueItems.map((item) => {
    const queuePosition = visibleQueuePositionById.get(item.id);
    return queuePosition === undefined ? item : { ...item, queuePosition };
  });

  return {
    visibleMessages,
    queuedQueueItems: displayQueuedQueueItems,
    queuedMessages,
    notifyQueueItems,
    effectivePendingBranchExecutionsByMessageId,
    errorsByMessageId,
    orphanErrorItems,
    activeConversationRun,
    activeProcessingTargetMessageId,
    showStreamingBubble: activeProcessingTargetMessageId !== null,
  };
}

function emptyAgentConversationViewModel(): AgentConversationViewModel {
  return {
    visibleMessages: [],
    queuedQueueItems: [],
    queuedMessages: [],
    notifyQueueItems: [],
    effectivePendingBranchExecutionsByMessageId: new Map(),
    errorsByMessageId: new Map(),
    orphanErrorItems: [],
    activeConversationRun: null,
    activeProcessingTargetMessageId: null,
    showStreamingBubble: false,
  };
}

function mapCanonicalMessage(
  message: AgentConversationChatViewMessage | null,
  turn: AgentConversationChatTurn,
): AgentChatMessage | null {
  if (!message) return null;
  const navigableSiblings = turn.branch.siblings.filter(
    (sibling) => typeof sibling.userMessageId === 'string' && sibling.userMessageId.length > 0,
  );
  const siblingUserMessageIds = navigableSiblings.map((sibling) => sibling.userMessageId!);
  const siblingTurnIds = navigableSiblings.map((sibling) => sibling.turnId);
  const siblingIndex = Math.max(
    0,
    navigableSiblings.findIndex((sibling) => sibling.turnId === turn.id),
  );
  const branchFields =
    message.direction === 'outbound' && siblingUserMessageIds.length > 1
      ? {
          siblingIndex,
          siblingCount: siblingUserMessageIds.length,
          siblingIds: siblingUserMessageIds,
          siblingTurnIds,
        }
      : {};

  return {
    id: message.id,
    direction: message.direction,
    content: message.content ?? '',
    createdAt: message.createdAt ?? turn.createdAt ?? new Date(0).toISOString(),
    type: message.type,
    metadata: serializeCanonicalMessageMetadata(message.metadata),
    attachments: normalizeAgentChatAttachments(message.attachments),
    parentId:
      message.direction === 'inbound'
        ? (turn.userMessage?.id ?? turn.parentTurnId)
        : turn.parentTurnId,
    previousUserMessageId: null,
    runId: message.direction === 'inbound' ? (turn.execution.run?.id ?? null) : null,
    turnId: turn.id,
    turnStatus: turn.status,
    turnType: turn.turnType,
    availableActions: turn.availableActions,
    supersedesTurnId: turn.edit.supersedesTurnId,
    supersededByTurnId: turn.edit.supersededByTurnId,
    isSupersededTurn: turn.edit.isSuperseded,
    ...branchFields,
  };
}

function serializeCanonicalMessageMetadata(
  metadata: string | Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  if (typeof metadata === 'string') return metadata;
  return JSON.stringify(metadata);
}

function mapCanonicalQueueItem(
  view: AgentConversationChatView,
  turn: AgentConversationChatTurn,
): AgentChatQueueItem | null {
  const queue = turn.execution.queue;
  if (!queue) return null;
  return {
    id: queue.id,
    agentId: view.agentId,
    conversationId: view.conversationId,
    mode:
      turn.turnType === 'response' || turn.turnType === 'edit'
        ? 'respond_to_message'
        : 'append_prompt',
    prompt: turn.userMessage?.content ?? '',
    status: canonicalStatusToQueueStatus(turn.status, queue.status),
    attempts: queue.attempts ?? 0,
    createdAt: turn.createdAt ?? queue.startedAt ?? new Date(0).toISOString(),
    updatedAt: turn.updatedAt ?? undefined,
    targetMessageId:
      turn.turnType === 'response' || turn.turnType === 'edit'
        ? (turn.userMessage?.id ?? null)
        : null,
    queuedMessageId: turn.userMessage?.id ?? null,
    previousUserMessageId: null,
    attachments: normalizeAgentChatAttachments(turn.userMessage?.attachments),
    runId: queue.runId ?? turn.execution.run?.id ?? null,
    errorMessage: queue.errorMessage ?? turn.execution.run?.errorMessage ?? null,
    turnId: turn.id,
    turnStatus: turn.status,
    availableActions: turn.availableActions,
    queuePosition: queue.position ?? null,
  };
}

function mapCanonicalNoticeItem(
  view: AgentConversationChatView,
  turn: AgentConversationChatTurn,
): AgentChatQueueItem {
  return {
    id: `turn-notice:${turn.id}`,
    agentId: view.agentId,
    conversationId: view.conversationId,
    mode:
      turn.turnType === 'response' || turn.turnType === 'edit'
        ? 'respond_to_message'
        : 'append_prompt',
    prompt: turn.userMessage?.content ?? '',
    status: canonicalStatusToQueueStatus(turn.status, null),
    attempts: 0,
    createdAt: turn.createdAt ?? new Date(0).toISOString(),
    targetMessageId: turn.userMessage?.id ?? null,
    queuedMessageId: turn.userMessage?.id ?? null,
    previousUserMessageId: null,
    attachments: normalizeAgentChatAttachments(turn.userMessage?.attachments),
    runId: turn.execution.run?.id ?? null,
    errorMessage: turn.execution.run?.errorMessage ?? null,
    turnId: turn.id,
    turnStatus: turn.status,
    availableActions: turn.availableActions.filter(
      (action) =>
        action !== 'retry' && action !== 'delete_queue_item' && action !== 'edit_queue_item',
    ),
  };
}

function mapCanonicalRun(turn: AgentConversationChatTurn): AgentConversationRunSummary | null {
  const run = turn.execution.run;
  if (!run || run.status !== 'running') return null;
  return {
    id: run.id,
    responseParentId: turn.userMessage?.id ?? null,
    status: 'running',
    startedAt: run.startedAt ?? turn.startedAt ?? turn.createdAt ?? new Date(0).toISOString(),
  };
}

function canonicalStatusToQueueStatus(
  turnStatus: AgentConversationChatTurnStatus,
  queueStatus: string | null,
): AgentChatQueueItem['status'] {
  if (queueStatus === 'queued' || queueStatus === 'processing' || queueStatus === 'completed') {
    return queueStatus;
  }
  if (queueStatus === 'failed' || queueStatus === 'cancelled') return queueStatus;
  if (turnStatus === 'processing') return 'processing';
  if (turnStatus === 'failed') return 'failed';
  if (turnStatus === 'stopped') return 'cancelled';
  if (turnStatus === 'completed' || turnStatus === 'superseded') return 'completed';
  return 'queued';
}

function queueItemToComparable(
  item: AgentChatQueueItem,
): Pick<AgentChatMessage, 'createdAt' | 'id'> {
  return { id: item.id, createdAt: item.createdAt };
}

export function buildAgentChatMarkdownExport(options: {
  agentName: string;
  conversationSubject: string | null;
  messages: AgentChatMessage[];
  /** When true, note sibling branch variants (export includes all branches). */
  includeAllBranches?: boolean;
}): string {
  const { agentName, conversationSubject, messages, includeAllBranches } = options;
  const title = conversationSubject?.trim() || 'Conversation';
  const exportedAt = new Date().toISOString();
  const lines: string[] = [
    `# ${title}`,
    '',
    `**Agent:** ${agentName}`,
    `**Exported:** ${exportedAt}`,
  ];
  if (includeAllBranches) {
    lines.push(
      '_This export lists every message from every branch (not only the branch visible in the UI). Chronological order may interleave parallel branches._',
    );
  }
  lines.push('', '---', '');

  for (const msg of messages) {
    const role = msg.direction === 'outbound' ? 'You' : 'Assistant';
    const when = new Date(msg.createdAt).toISOString();
    lines.push(`## ${role}`);
    lines.push(`_${when}_`);
    if (
      includeAllBranches &&
      typeof msg.siblingCount === 'number' &&
      msg.siblingCount > 1 &&
      typeof msg.siblingIndex === 'number'
    ) {
      lines.push(
        `_Branch variant ${msg.siblingIndex + 1} of ${msg.siblingCount} at this tree step._`,
      );
    }
    lines.push('');
    const attachments = normalizeAgentChatAttachments(msg.attachments);
    if (attachments?.length) {
      for (const att of attachments) {
        lines.push(`- _Attachment (${att.type}):_ \`${att.fileName}\` (${att.mimeType})`);
      }
      lines.push('');
    }
    const body = msg.content?.trim();
    if (body) {
      lines.push(body);
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
