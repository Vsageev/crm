import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('./AgentsPage.tsx', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const cssPath = fileURLToPath(new URL('./AgentsPage.module.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf8');

function failContract(options: {
  componentName: string;
  stateInput: string;
  contractName: string;
  expected: string;
  actual: string;
}): never {
  throw new Error(
    `${options.componentName} component contract violated: stateInput=${options.stateInput} classOrContractName=${options.contractName} expected=${options.expected} actual=${options.actual}`,
  );
}

function sourceSlice(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  if (start < 0) {
    failContract({
      componentName: 'AgentsPage',
      stateInput: 'source',
      contractName: startNeedle,
      expected: 'source marker exists',
      actual: 'missing',
    });
  }
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) {
    failContract({
      componentName: 'AgentsPage',
      stateInput: 'source',
      contractName: endNeedle,
      expected: 'source marker exists after start marker',
      actual: 'missing',
    });
  }
  return source.slice(start, end);
}

function sourceSliceFromCss(startNeedle: string, endNeedle: string): string {
  const start = cssSource.indexOf(startNeedle);
  if (start < 0) {
    failContract({
      componentName: 'AgentsPageCss',
      stateInput: 'css',
      contractName: startNeedle,
      expected: 'css marker exists',
      actual: 'missing',
    });
  }
  const end = cssSource.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) {
    failContract({
      componentName: 'AgentsPageCss',
      stateInput: 'css',
      contractName: endNeedle,
      expected: 'css marker exists after start marker',
      actual: 'missing',
    });
  }
  return cssSource.slice(start, end);
}

function assertContains(options: {
  componentName: string;
  stateInput: string;
  contractName: string;
  sourceText: string;
  expected: string;
}) {
  if (!options.sourceText.includes(options.expected)) {
    failContract({
      componentName: options.componentName,
      stateInput: options.stateInput,
      contractName: options.contractName,
      expected: options.expected,
      actual: options.sourceText.trim().replace(/\s+/g, ' ').slice(0, 500),
    });
  }
}

function assertNotContains(options: {
  componentName: string;
  stateInput: string;
  contractName: string;
  sourceText: string;
  unexpected: string;
}) {
  if (options.sourceText.includes(options.unexpected)) {
    failContract({
      componentName: options.componentName,
      stateInput: options.stateInput,
      contractName: options.contractName,
      expected: `source does not include ${options.unexpected}`,
      actual: options.sourceText.trim().replace(/\s+/g, ' ').slice(0, 500),
    });
  }
}

describe('AgentsPage component contract', () => {
  it('binds active conversation selection to sidebar, chat, queued rows, and composer ownership', () => {
    const sidebar = sourceSlice('data-testid="agents-sidebar"', 'data-testid="agents-chat-panel"');
    assertContains({
      componentName: 'AgentsPageSidebar',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'active-selection-data-attributes',
      sourceText: sidebar,
      expected: "data-active-agent-id={activeAgentId ?? ''}",
    });
    assertContains({
      componentName: 'AgentsPageSidebar',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'active-selection-data-attributes',
      sourceText: sidebar,
      expected: "data-active-conversation-id={activeConvId ?? ''}",
    });
    const sidebarItemBinding = sourceSlice('const renderAgentSidebarItem =', 'return (');
    assertContains({
      componentName: 'AgentSidebarItem',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'active-conversation-prop',
      sourceText: sidebarItemBinding,
      expected: 'activeConversationId={',
    });
    assertContains({
      componentName: 'AgentSidebarItem',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'active-conversation-prop-owner',
      sourceText: sidebarItemBinding,
      expected: 'activeAgentId === agent.id ? activeConvId : null',
    });

    const chat = sourceSlice('data-testid="agents-chat-panel"', '<ReplyComposer');
    assertContains({
      componentName: 'AgentsPageChatPanel',
      stateInput: 'mobileChatOpen=true activeConvId=conversation-active',
      contractName: 'chat-panel-active-selection',
      sourceText: chat,
      expected: "data-active-conversation-id={activeConvId ?? ''}",
    });

    const queuedRow = sourceSlice(
      'const transcriptExecutionItem =',
      '<div className={styles.messageContent}>',
    );
    assertContains({
      componentName: 'QueuedMessageRow',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'queued-row-active-owner',
      sourceText: queuedRow,
      expected: "data-active-agent-id={activeAgentId ?? ''}",
    });
    assertContains({
      componentName: 'QueuedMessageRow',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'queued-row-active-owner',
      sourceText: queuedRow,
      expected: "data-active-conversation-id={activeConvId ?? ''}",
    });

    const composer = sourceSlice('<ReplyComposer', '/>');
    assertContains({
      componentName: 'ReplyComposer',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'composer-owner-props',
      sourceText: composer,
      expected: 'activeAgentId={activeAgentId}',
    });
    assertContains({
      componentName: 'ReplyComposer',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'composer-owner-props',
      sourceText: composer,
      expected: 'activeConversationId={activeConvId}',
    });
    assertContains({
      componentName: 'ReplyComposer',
      stateInput: 'activeAgentId=agent-active activeConvId=conversation-active',
      contractName: 'composer-send-handler',
      sourceText: composer,
      expected: 'onSendText={sendTextMessage}',
    });
  });

  it('captures composer send ownership before async state can switch conversations', () => {
    const sendTextMessage = sourceSlice(
      'const sendTextMessage = useCallback(',
      'const toggleAgentCollapse = useCallback(',
    );
    for (const expected of [
      'const sentAgentId = activeAgentId;',
      'const sentConvId = activeConvId;',
      'agentId: sentAgentId',
      'conversationId: sentConvId',
      '`/agents/${sentAgentId}/chat/message`',
      'conversationId: sentConvId',
    ]) {
      assertContains({
        componentName: 'AgentsPage.sendTextMessage',
        stateInput: 'active switches while prompt is queued',
        contractName: 'composer-send-owner-capture',
        sourceText: sendTextMessage,
        expected,
      });
    }
  });

  it('keeps backend-queued chat turns polling after the first send handoff', () => {
    const activeState = sourceSlice(
      'const activeMessageIds = useMemo(',
      'const activeAgentWorkspaceIds = useMemo(',
    );
    for (const expected of [
      'const activeChatSurfaceMessageIds = useMemo(() => {',
      'for (const { message } of queuedMessages) {',
      'activeChatSurfaceMessageIds.has(optimisticActiveTargetId)',
      'const shouldSyncActiveConversation = streaming || queuedQueueItems.length > 0;',
    ]) {
      assertContains({
        componentName: 'AgentsPage.activeConversationState',
        stateInput: 'first sent message is temporarily backend-queued',
        contractName: 'queued-turn-sync-handoff',
        sourceText: activeState,
        expected,
      });
    }

    const syncEffect = sourceSlice(
      '// While a run is active or queued, keep the active chat state in sync',
      'const wasStreamingRef = useRef(false);',
    );
    assertContains({
      componentName: 'AgentsPage.activeConversationSync',
      stateInput: 'canonical view has queued row but no streaming run yet',
      contractName: 'queued-turn-sync-loop',
      sourceText: syncEffect,
      expected: 'if (!shouldSyncActiveConversation || !activeAgentId || !activeConvId) {',
    });
  });

  it('detects stale AgentSidebarItem row state when active conversation or per-row pending keys change', () => {
    const memoEq = sourceSlice(
      'function areAgentSidebarItemPropsEqual(',
      'function areChatConversationListsEqual(',
    );
    assertContains({
      componentName: 'AgentSidebarItem.memo',
      stateInput: 'activeConversationId switch during queued/streaming badges',
      contractName: 'memo-active-conversation',
      sourceText: memoEq,
      expected: 'if (prev.activeConversationId !== next.activeConversationId) return false;',
    });
    assertContains({
      componentName: 'AgentSidebarItem.memo',
      stateInput: 'main chat Thinking/streaming without isBusy or pending keys',
      contractName: 'memo-open-chat-panel-streaming',
      sourceText: memoEq,
      expected: 'if (prev.openChatPanelStreaming !== next.openChatPanelStreaming) return false;',
    });
    assertContains({
      componentName: 'AgentSidebarItem.memo',
      stateInput: 'pendingConversationKeys differs for same conversation list ref',
      contractName: 'memo-pending-keys-per-conversation',
      sourceText: memoEq,
      expected:
        'if (prev.pendingConversationKeys.has(key) !== next.pendingConversationKeys.has(key)) {',
    });
    assertContains({
      componentName: 'AgentSidebarItem.memo',
      stateInput: 'runHandoffKeys differs for same conversation list ref',
      contractName: 'memo-run-handoff-keys-per-conversation',
      sourceText: memoEq,
      expected: 'if (prev.runHandoffKeys.has(key) !== next.runHandoffKeys.has(key)) {',
    });
  });

  it('ties sidebar/chat layout data attributes to the same mobileChatOpen switch', () => {
    const layout = sourceSlice(
      'data-testid="agents-layout-container"',
      'data-testid="agents-sidebar"',
    );
    assertContains({
      componentName: 'AgentsPage',
      stateInput: 'two-pane root',
      contractName: 'agents-layout-container',
      sourceText: layout,
      expected: 'data-testid="agents-layout-container"',
    });

    const sidebar = sourceSlice('data-testid="agents-sidebar"', 'data-testid="agents-chat-panel"');
    const chat = sourceSlice('data-testid="agents-chat-panel"', '{activeAgent && activeConvId');
    const layoutState =
      "data-layout-state={mobileChatOpen ? 'mobile-chat-open' : 'mobile-sidebar-open'}";
    assertContains({
      componentName: 'AgentsPage.sidebar',
      stateInput: 'mobileChatOpen boolean',
      contractName: 'data-layout-state',
      sourceText: sidebar,
      expected: layoutState,
    });
    assertContains({
      componentName: 'AgentsPage.chatPanel',
      stateInput: 'mobileChatOpen boolean',
      contractName: 'data-layout-state',
      sourceText: chat,
      expected: layoutState,
    });

    const sidebarOpenLine = sourceSlice(
      'className={`${styles.sidebar} ${mobileChatOpen ? styles.sidebarMobileHidden : styles.sidebarMobileOpen}`}',
      'data-testid="agents-sidebar"',
    );
    assertContains({
      componentName: 'AgentsPage.sidebar',
      stateInput: 'mobileChatOpen toggles sidebar visibility classes',
      contractName: 'mutually-exclusive-mobile-classNames',
      sourceText: sidebarOpenLine,
      expected:
        'className={`${styles.sidebar} ${mobileChatOpen ? styles.sidebarMobileHidden : styles.sidebarMobileOpen}`}',
    });

    const chatOpenLine = sourceSlice(
      'className={`${styles.chatPanel} ${mobileChatOpen ? styles.chatPanelMobileOpen : styles.chatPanelMobileHidden}`}',
      'data-testid="agents-chat-panel"',
    );
    assertContains({
      componentName: 'AgentsPage.chatPanel',
      stateInput: 'mobileChatOpen toggles chat visibility classes',
      contractName: 'mutually-exclusive-mobile-classNames',
      sourceText: chatOpenLine,
      expected:
        'className={`${styles.chatPanel} ${mobileChatOpen ? styles.chatPanelMobileOpen : styles.chatPanelMobileHidden}`}',
    });
  });

  it('routes queued branch-response edits through the queue editor without blocking active edits', () => {
    const messageRender = sourceSlice(
      'const pendingBranchExecutions =',
      "{msg.direction === 'inbound' && (",
    );
    for (const expected of [
      'effectivePendingBranchExecutionsByMessageId.get(msg.id) ?? []',
      "pendingBranchExecutions.find((item) => item.status === 'queued') ?? null",
      'editableBranchQueueItem',
      'startEditingQueuedMessage(msg, editableBranchQueueItem)',
      'startEditingMessage(msg)',
      "'Edit queued message'",
      'disabled={editingMessage?.isSubmitting}',
    ]) {
      assertContains({
        componentName: 'AgentsPage.messageMeta',
        stateInput: 'outbound message has queued respond_to_message item',
        contractName: 'branch-response-queue-edit-path',
        sourceText: messageRender,
        expected,
      });
    }
    for (const unexpected of [
      'isBranchQueueEditBlocked',
      "'Stop the running response before editing this message.'",
      'styles.editMsgBtnLocked',
    ]) {
      assertNotContains({
        componentName: 'AgentsPage.messageMeta',
        stateInput: 'outbound message has processing respond_to_message item',
        contractName: 'branch-response-active-edit-not-blocked',
        sourceText: messageRender,
        unexpected,
      });
    }
  });

  it('opens normal message editing for processing transcript execution rows', () => {
    const queuedEditButton = sourceSlice(
      'const transcriptExecutionItemId =',
      "{msg.direction === 'inbound' && (",
    );
    for (const expected of [
      'if (editableBranchQueueItem) {',
      'startEditingMessage(msg)',
      'startEditingQueuedMessage(msg, editableBranchQueueItem)',
      'disabled={editingMessage?.isSubmitting}',
    ]) {
      assertContains({
        componentName: 'AgentsPage.queuedMessageRow',
        stateInput: 'transcript message row has status=processing',
        contractName: 'processing-transcript-row-edit-message',
        sourceText: queuedEditButton,
        expected,
      });
    }
    assertNotContains({
      componentName: 'AgentsPage.queuedMessageRow',
      stateInput: 'transcript message row has status=processing',
      contractName: 'processing-transcript-row-edit-message',
      sourceText: queuedEditButton,
      unexpected: 'disabled={\n                                                isProcessingTranscriptMessage ||',
    });
    assertNotContains({
      componentName: 'AgentsPage.queuedMessageRow',
      stateInput: 'transcript message row has status=processing',
      contractName: 'processing-transcript-row-status-chip-removed',
      sourceText: queuedEditButton,
      unexpected: 'styles.messageExecutionStateProcessing',
    });
  });

  it('does not hide user message editing by message type', () => {
    const editablePredicate = sourceSlice(
      'export function isEditableChatMessage(message: ChatMessage): boolean {',
      'function readAgentChatDraft(): string',
    );
    for (const unexpected of [
      "type === 'text'",
      "type === 'image'",
      "type === 'file'",
      'message.type ??',
    ]) {
      assertNotContains({
        componentName: 'AgentsPage.isEditableChatMessage',
        stateInput: 'outbound non-text message',
        contractName: 'all-outbound-action-authorized-types-editable',
        sourceText: editablePredicate,
        unexpected,
      });
    }
  });

  it('keeps run activity collapsed until the user expands it', () => {
    const runActivity = sourceSlice('function AgentRunActivity({', 'function formatBytes');
    const runEventRow = sourceSlice('function AgentRunEventRow({', 'function AgentRunEventTimeline');
    for (const expected of [
      'const [expanded, setExpanded] = useState(false);',
      'data-testid="agent-run-activity"',
      "data-run-activity-expanded={expanded ? 'true' : 'false'}",
      'className={styles.agentRunActivityToggle}',
      'onClick={() => setExpanded((value) => !value)}',
      'aria-expanded={expanded}',
      '{!expanded && (',
      '<AgentRunEventRow event={latestEvent} compact />',
      '{expanded && (',
      '<AgentRunEventTimeline events={summary.events} />',
    ]) {
      assertContains({
        componentName: 'AgentRunActivity',
        stateInput: 'run activity longer than collapsed preview',
        contractName: 'activity-explicit-expand',
        sourceText: runActivity,
        expected,
      });
    }

    for (const expected of [
      "const isDraft = event.kind === 'assistant_text'",
      'styles.agentRunEventTextOutputDetail',
      'styles.agentRunEventTextOutputRow',
      'const [detailExpanded, setDetailExpanded] = useState(false);',
      'styles.agentRunEventDetailToggle',
    ]) {
      assertContains({
        componentName: 'AgentRunEventRow',
        stateInput: 'drafting response stream row',
        contractName: 'draft-full-detail-row',
        sourceText: runEventRow,
        expected,
      });
    }
  });

  it('keeps completed run history attached to the assistant message, not the meta row', () => {
    const messageRender = sourceSlice(
      'const messageRunOutputBlocks = parseRunDetailOutputBlocks(messageRunDetail);',
      '<div\n                                  className={`${styles.messageMeta} ${',
    );
    for (const expected of [
      '<MarkdownContent',
      '{msg.content}',
      'messageRunEventSummary.stats.updates > 0 && (',
      'hideFinalDraft:',
      '<AgentRunActivity',
      'mode="history"',
    ]) {
      assertContains({
        componentName: 'AgentsPage.completedAssistantMessage',
        stateInput: 'completed inbound message has a run timeline',
        contractName: 'history-attached-to-message',
        sourceText: messageRender,
        expected,
      });
    }

    const messageMeta = sourceSlice(
      "className={`${styles.messageMeta} ${",
      "{errorsByMessageId.get(msg.id)?.map((item) => (",
    );
    assertNotContains({
      componentName: 'AgentsPage.completedAssistantMessageMeta',
      stateInput: 'completed inbound message has a run timeline',
      contractName: 'history-not-in-meta-row',
      sourceText: messageMeta,
      unexpected: '<AgentRunActivity',
    });
  });

  it('uses one floating chat date badge driven by scroll position', () => {
    const scrollState = sourceSlice(
      'const updateFloatingChatDate = useCallback(() => {',
      'const requestAutoScrollToBottom = useCallback(() => {',
    );
    for (const expected of [
      "'[data-chat-date-group-label]'",
      'dateGroup.getBoundingClientRect().top > probeTop',
      'visible: element.scrollTop > 8 && activeLabel !== null',
      'setFloatingChatDate',
    ]) {
      assertContains({
        componentName: 'AgentsPage.chatDateBadge',
        stateInput: 'messages scrolled across date separators',
        contractName: 'floating-date-scroll-state',
        sourceText: scrollState,
        expected,
      });
    }

    const messagesRender = sourceSlice(
      'data-testid="agents-messages-area"',
      '{visibleMessages.map((msg, index) => {',
    );
    for (const expected of [
      'styles.chatDateStickyLayer',
      'styles.chatDateStickyLabel',
      'floatingChatDate.visible',
    ]) {
      assertContains({
        componentName: 'AgentsPage.chatDateBadge',
        stateInput: 'active chat transcript',
        contractName: 'floating-date-rendered-once',
        sourceText: messagesRender,
        expected,
      });
    }

    const dateSeparatorRender = sourceSlice(
      'const dateGroupLabel = showDateGroup',
      '<div\n                              className={`${styles.messageRow}',
    );
    assertContains({
      componentName: 'AgentsPage.chatDateSeparator',
      stateInput: 'message starts a new local day',
      contractName: 'date-label-data-source',
      sourceText: dateSeparatorRender,
      expected: 'data-chat-date-group-label={dateGroupLabel}',
    });

    const dateGroupCss = sourceSliceFromCss('.chatDateGroup {', '.chatDateStickyLayer {');
    assertNotContains({
      componentName: 'AgentsPage.chatDateSeparator',
      stateInput: 'message starts a new local day',
      contractName: 'inline-separator-not-sticky',
      sourceText: dateGroupCss,
      unexpected: 'position: sticky',
    });
    assertContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'sticky-layer-css',
      sourceText: cssSource,
      expected: '.chatDateStickyLayer',
    });
    assertContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'sticky-layer-position',
      sourceText: cssSource,
      expected: 'position: sticky',
    });
    assertContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'sticky-layer-avoids-text-clipping',
      sourceText: cssSource,
      expected: 'min-height: 30px',
    });
    assertContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'date-label-uses-explicit-line-box',
      sourceText: cssSource,
      expected: 'line-height: 16px',
    });
    const chatDateCss = sourceSliceFromCss('.chatDateGroup {', '.messageContent {');
    assertContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'floating-date-flat-surface',
      sourceText: chatDateCss,
      expected: 'background: var(--color-card)',
    });
    assertNotContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'floating-date-no-shadow',
      sourceText: chatDateCss,
      unexpected: 'box-shadow',
    });
    assertNotContains({
      componentName: 'AgentsPage.chatDateBadge',
      stateInput: 'messages scrolled across date separators',
      contractName: 'floating-date-no-backdrop-blur',
      sourceText: chatDateCss,
      unexpected: 'backdrop-filter',
    });
  });

  it('uses the same activity panel for live streaming runs', () => {
    const streamingRender = sourceSlice('{showStreamingBubble && (', '{queuedMessages.length > 0 && (');
    for (const expected of [
      '<AgentRunActivity summary={activeRunEventSummary} mode="live" />',
    ]) {
      assertContains({
        componentName: 'AgentsPage.streamingRun',
        stateInput: 'active chat run is streaming',
        contractName: 'live-activity-panel',
        sourceText: streamingRender,
        expected,
      });
    }
  });

});
