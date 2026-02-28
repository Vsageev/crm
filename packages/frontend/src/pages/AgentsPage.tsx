import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Plus,
  Trash2,
  X,
  Power,
  PowerOff,
  ExternalLink,
  Key,
  Terminal,
  AlertTriangle,
  Download,
  Search,
  Send,
  MessageSquare,
  Settings,
  FolderOpen,
  Folder,
  File,
  FileText,
  Image,
  Upload,
  FolderPlus,
  ChevronRight,
  CornerLeftUp,
  HardDrive,
  Eye,
  Copy,
  Check,
} from 'lucide-react';
import { Button, Badge, Input, Textarea, Select, ApiKeyFormFields, Tooltip } from '../ui';
import { api, apiUpload, ApiError } from '../lib/api';
import { formatFileSize, formatFileDate, isTextPreviewable, isImagePreviewable, isPreviewable } from '../lib/file-utils';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { AgentAvatar, AgentAvatarPicker, randomPalette, randomIcon, type AvatarConfig } from '../components/AgentAvatar';
import {
  getLatestStreamingAgentChatStream,
  markAgentChatConversationRead,
  startAgentChatStream,
  useAgentChatUnreadConversationIds,
  useAgentChatStreams,
} from '../stores/agent-chat-runtime';
import styles from './AgentsPage.module.css';

/* ── Types ── */

interface CliInfo {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  downloadUrl: string;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  isActive: boolean;
  expiresAt?: string | null;
}

interface ApiKeysResponse {
  total: number;
  limit: number;
  offset: number;
  entries: ApiKey[];
}

interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  preset: string;
  status: 'active' | 'inactive' | 'error';
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  lastActivity: string | null;
  capabilities: string[];
  skipPermissions?: boolean;
  avatarIcon: string;
  avatarBgColor: string;
  avatarLogoColor: string;
  createdAt: string;
}

interface AgentsResponse {
  total: number;
  limit: number;
  offset: number;
  entries: Agent[];
}

interface Preset {
  id: string;
  name: string;
  description: string;
}

interface ChatConversation {
  id: string;
  subject: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
}

/* ── Constants ── */

const STATUS_COLOR: Record<Agent['status'], 'success' | 'default' | 'error'> = {
  active: 'success',
  inactive: 'default',
  error: 'error',
};

const STATUS_LABEL: Record<Agent['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  error: 'Error',
};

const MODELS = [
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    description: 'Strong reasoning, safety-focused. Best for complex workflows.',
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    description: 'Code-first agent model. Good for dev-oriented tasks.',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    vendor: 'Alibaba',
    description: 'Open-weight model. Good for self-hosted deployments.',
  },
] as const;

type ModelId = (typeof MODELS)[number]['id'];

interface CreateAgentForm {
  name: string;
  description: string;
  model: ModelId;
  preset: string;
  apiKeyId: string;
  skipPermissions: boolean;
  newKey: boolean;
  newKeyPermissions: string[];
  avatar: AvatarConfig;
}

function makeEmptyForm(): CreateAgentForm {
  const [bgColor, logoColor] = randomPalette();
  return {
    name: '',
    description: '',
    model: 'claude',
    preset: 'basic',
    apiKeyId: '',
    skipPermissions: false,
    newKey: false,
    newKeyPermissions: [],
    avatar: { icon: randomIcon(), bgColor, logoColor },
  };
}

/* ── Helpers ── */

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getSkipPermissionsFlag(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized === 'claude') return '--dangerously-skip-permissions';
  if (normalized === 'codex') return '--dangerously-bypass-approvals-and-sandbox';
  if (normalized === 'qwen') return '--approval-mode yolo';
  return 'not supported';
}

/* ── Agent file entry type ── */

type AgentFileEntry = import('../lib/file-utils').FileEntry;

function getAgentFileIcon(entry: AgentFileEntry) {
  if (isImagePreviewable(entry.name)) return <Image size={18} className={styles.filesIconFile} />;
  if (isTextPreviewable(entry.name)) return <FileText size={18} className={styles.filesIconFile} />;
  return <File size={18} className={styles.filesIconFile} />;
}

/* ── Agent Files sub-component ── */

function AgentFiles({ agentId }: { agentId: string }) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<AgentFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Preview
  const [previewEntry, setPreviewEntry] = useState<AgentFileEntry | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const fetchEntries = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: AgentFileEntry[] }>(
        `/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`,
      );
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setCurrentPath('/');
  }, [agentId]);

  useEffect(() => {
    fetchEntries(currentPath);
  }, [currentPath, fetchEntries]);

  function navigateTo(dirPath: string) {
    setCurrentPath(dirPath);
    setShowNewFolder(false);
    setDeletingPath(null);
  }

  const pathSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  async function handleCreateFolder() {
    if (!folderName.trim()) return;
    setCreatingFolder(true);
    setError('');
    try {
      await api(`/agents/${agentId}/files/folders`, {
        method: 'POST',
        body: JSON.stringify({ path: currentPath, name: folderName.trim() }),
      });
      setShowNewFolder(false);
      setFolderName('');
      setSuccess('Folder created');
      await fetchEntries(currentPath);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  }

  async function uploadFile(file: globalThis.File) {
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('path', currentPath);
      formData.append('file', file);
      await apiUpload(`/agents/${agentId}/files/upload`, formData);
      setSuccess('File uploaded');
      await fetchEntries(currentPath);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }

  async function handleDelete(itemPath: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/agents/${agentId}/files?path=${encodeURIComponent(itemPath)}`, { method: 'DELETE' });
      setDeletingPath(null);
      setSuccess('Item deleted');
      await fetchEntries(currentPath);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete item');
    } finally {
      setDeleteLoading(false);
    }
  }

  function handleDownload(filePath: string) {
    const token = localStorage.getItem('ws_access_token');
    const url = `/api/agents/${agentId}/files/download?path=${encodeURIComponent(filePath)}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = filePath.split('/').pop() || 'file';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(objUrl);
        a.remove();
      })
      .catch(() => setError('Failed to download file'));
  }

  function handleEntryClick(entry: AgentFileEntry) {
    if (entry.type === 'folder') {
      navigateTo(entry.path);
    } else if (isPreviewable(entry.name)) {
      setPreviewEntry(entry);
    } else {
      handleDownload(entry.path);
    }
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parentPath = currentPath === '/'
    ? null
    : '/' + currentPath.split('/').filter(Boolean).slice(0, -1).join('/');

  return (
    <div className={styles.filesPanel}>
      <input
        ref={fileInputRef}
        type="file"
        className={styles.filesHiddenInput}
        onChange={handleUpload}
      />

      {/* Breadcrumb */}
      <nav className={styles.filesBreadcrumb}>
        <button
          className={`${styles.filesBreadcrumbItem} ${currentPath === '/' ? styles.filesBreadcrumbActive : ''}`}
          onClick={() => navigateTo('/')}
        >
          <HardDrive size={14} />
          Files
        </button>
        {pathSegments.map((segment, i) => {
          const segPath = '/' + pathSegments.slice(0, i + 1).join('/');
          const isLast = i === pathSegments.length - 1;
          return (
            <span key={segPath} className={styles.filesBreadcrumbSep}>
              <ChevronRight size={14} />
              <button
                className={`${styles.filesBreadcrumbItem} ${isLast ? styles.filesBreadcrumbActive : ''}`}
                onClick={() => navigateTo(segPath)}
              >
                {segment}
              </button>
            </span>
          );
        })}
      </nav>

      {success && <div className={styles.filesToast}>{success}</div>}
      {error && <div className={styles.filesError}>{error}</div>}

      {loading ? (
        <div className={styles.loadingState}>Loading...</div>
      ) : (
        <div className={styles.filesTable}>
          <div className={styles.filesTableHeader}>
            <span className={styles.filesColName}>Name</span>
            <span className={styles.filesColSize}>Size</span>
            <span className={styles.filesColDate}>Modified</span>
            <span className={styles.filesColActions}>
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={14} />
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowNewFolder(!showNewFolder);
                  setFolderName('');
                }}
              >
                <FolderPlus size={14} />
                Folder
              </Button>
            </span>
          </div>

          {showNewFolder && (
            <div className={styles.filesNewFolderRow}>
              <div className={styles.filesNewFolderIcon}>
                <Folder size={18} className={styles.filesIconFolder} />
              </div>
              <Input
                label=""
                placeholder="Folder name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolder(false);
                }}
              />
              <Button size="sm" onClick={handleCreateFolder} disabled={creatingFolder || !folderName.trim()}>
                {creatingFolder ? 'Creating...' : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(false)}>
                Cancel
              </Button>
            </div>
          )}

          {parentPath !== null && (
            <div className={styles.filesRow}>
              <button className={styles.filesColName} onClick={() => navigateTo(parentPath === '/' ? '/' : parentPath)}>
                <CornerLeftUp size={18} className={styles.filesIconFile} />
                <span className={styles.filesFileName}>..</span>
              </button>
              <span className={styles.filesColSize}>—</span>
              <span className={styles.filesColDate}>—</span>
              <span className={styles.filesColActions} />
            </div>
          )}

          {sorted.length === 0 ? (
            <div
              className={`${styles.filesEmpty} ${dragOver ? styles.filesEmptyDragOver : ''}`}
              onDrop={handleDrop}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload size={32} strokeWidth={1.5} />
              <p>Drop files here or use the upload button</p>
            </div>
          ) : (
            <div
              className={`${styles.filesDropTarget} ${dragOver ? styles.filesDropTargetActive : ''}`}
              onDrop={handleDrop}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {sorted.map((entry) => (
                <div key={entry.path} className={styles.filesRow}>
                  <button className={styles.filesColName} onClick={() => handleEntryClick(entry)}>
                    {entry.type === 'folder' ? (
                      <Folder size={18} className={styles.filesIconFolder} />
                    ) : (
                      getAgentFileIcon(entry)
                    )}
                    <span className={styles.filesFileName}>{entry.name}</span>
                  </button>
                  <span className={styles.filesColSize}>{entry.type === 'file' ? formatFileSize(entry.size) : '—'}</span>
                  <span className={styles.filesColDate}>{formatFileDate(entry.createdAt)}</span>
                  <span className={styles.filesColActions}>
                    {entry.type === 'file' && isPreviewable(entry.name) && (
                      <Tooltip label="Preview">
                        <button
                          className={styles.filesIconBtn}
                          onClick={() => setPreviewEntry(entry)}
                          aria-label="Preview"
                        >
                          <Eye size={16} />
                        </button>
                      </Tooltip>
                    )}
                    {entry.type === 'file' && (
                      <Tooltip label="Download">
                        <button
                          className={styles.filesIconBtn}
                          onClick={() => handleDownload(entry.path)}
                          aria-label="Download"
                        >
                          <Download size={16} />
                        </button>
                      </Tooltip>
                    )}
                    {deletingPath === entry.path ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setDeletingPath(null)} disabled={deleteLoading}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => handleDelete(entry.path)} disabled={deleteLoading}>
                          {deleteLoading ? 'Deleting...' : 'Confirm'}
                        </Button>
                      </>
                    ) : (
                      <Tooltip label="Delete">
                        <button
                          className={`${styles.filesIconBtn} ${styles.filesIconBtnDanger}`}
                          onClick={() => setDeletingPath(entry.path)}
                          aria-label="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </Tooltip>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {previewEntry && (
        <FilePreviewModal
          fileName={previewEntry.name}
          downloadUrl={`/api/agents/${agentId}/files/download?path=${encodeURIComponent(previewEntry.path)}`}
          onClose={() => setPreviewEntry(null)}
          onDownload={() => handleDownload(previewEntry.path)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export function AgentsPage() {
  // ── Agent list state ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ── Selection state ──
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // ── Per-agent conversations ──
  const [convsByAgent, setConvsByAgent] = useState<Record<string, ChatConversation[]>>({});

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isFirstMessageRef = useRef(false);
  const activeAgentIdRef = useRef<string | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const previousStreamStatusRef = useRef<Map<string, 'streaming' | 'done' | 'error'>>(new Map());

  // ── Conversation indicators ──
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatStreams = useAgentChatStreams();
  const unreadConversationIds = useAgentChatUnreadConversationIds();

  // ── Create modal ──
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateAgentForm>(makeEmptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [cliStatus, setCliStatus] = useState<CliInfo[]>([]);

  // ── Chat / Files tab ──
  const [chatTab, setChatTab] = useState<'chat' | 'files'>('chat');

  // ── Settings modal ──
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Keep ref in sync for closure access
  activeAgentIdRef.current = activeAgentId;
  activeConvIdRef.current = activeConvId;

  const streamingConversationIds = useMemo(
    () => new Set(chatStreams.filter((stream) => stream.status === 'streaming').map((stream) => stream.conversationId)),
    [chatStreams],
  );
  const activeStream = useMemo(
    () =>
      chatStreams.find(
        (stream) =>
          stream.status === 'streaming' &&
          stream.agentId === activeAgentId &&
          stream.conversationId === activeConvId,
      ) ?? null,
    [chatStreams, activeAgentId, activeConvId],
  );
  const streaming = Boolean(activeStream);
  const streamText = activeStream?.text ?? '';
  const unreadConvIds = useMemo(() => new Set(unreadConversationIds), [unreadConversationIds]);

  /* ── Fetch agents ── */
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<AgentsResponse>('/agents?limit=100');
      setAgents(data.entries);
      return data.entries;
    } catch {
      // silently fail
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch conversations for an agent ── */
  const fetchConversations = useCallback(async (agentId: string) => {
    try {
      const data = await api<{ entries: ChatConversation[]; total: number }>(
        `/agents/${agentId}/chat/conversations`,
      );
      setConvsByAgent((prev) => ({ ...prev, [agentId]: data.entries }));
      return data.entries;
    } catch {
      return [];
    }
  }, []);

  /* ── Fetch messages ── */
  const fetchMessages = useCallback(async (agentId: string, conversationId: string) => {
    try {
      const data = await api<{ entries: ChatMessage[] }>(
        `/agents/${agentId}/chat/messages?conversationId=${conversationId}`,
      );
      setMessages(data.entries);
      isFirstMessageRef.current = data.entries.length === 0;
    } catch {
      setChatError('Failed to load messages');
    }
  }, []);

  /* ── Initial load ── */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await fetchAgents();
      if (cancelled || entries.length === 0) return;

      // Load conversations for all agents
      const allConvs: Record<string, ChatConversation[]> = {};
      await Promise.all(
        entries.map(async (agent) => {
          try {
            const data = await api<{ entries: ChatConversation[]; total: number }>(
              `/agents/${agent.id}/chat/conversations`,
            );
            allConvs[agent.id] = data.entries;
          } catch {
            allConvs[agent.id] = [];
          }
        }),
      );
      if (cancelled) return;
      setConvsByAgent(allConvs);

      const latestStreaming = getLatestStreamingAgentChatStream();
      if (latestStreaming) {
        const streamConvs = allConvs[latestStreaming.agentId] || [];
        const streamConvExists = streamConvs.some((conv) => conv.id === latestStreaming.conversationId);
        if (streamConvExists) {
          setActiveAgentId(latestStreaming.agentId);
          setActiveConvId(latestStreaming.conversationId);
          const msgData = await api<{ entries: ChatMessage[] }>(
            `/agents/${latestStreaming.agentId}/chat/messages?conversationId=${latestStreaming.conversationId}`,
          );
          if (!cancelled) {
            setMessages(msgData.entries);
            isFirstMessageRef.current = msgData.entries.length === 0;
          }
          return;
        }
      }

      // Auto-select first agent's first conversation
      const firstAgent = entries[0];
      const firstConvs = allConvs[firstAgent.id] || [];
      if (firstConvs.length > 0) {
        setActiveAgentId(firstAgent.id);
        setActiveConvId(firstConvs[0].id);
        const msgData = await api<{ entries: ChatMessage[] }>(
          `/agents/${firstAgent.id}/chat/messages?conversationId=${firstConvs[0].id}`,
        );
        if (!cancelled) {
          setMessages(msgData.entries);
          isFirstMessageRef.current = msgData.entries.length === 0;
        }
      } else {
        setActiveAgentId(firstAgent.id);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fetchAgents]);

  /* ── React to stream lifecycle updates ── */
  useEffect(() => {
    const previous = previousStreamStatusRef.current;
    const next = new Map<string, 'streaming' | 'done' | 'error'>();

    for (const stream of chatStreams) {
      next.set(stream.id, stream.status);
      const previousStatus = previous.get(stream.id);

      if (previousStatus !== 'streaming') continue;

      if (stream.status === 'done') {
        if (
          activeAgentIdRef.current === stream.agentId &&
          activeConvIdRef.current === stream.conversationId
        ) {
          markAgentChatConversationRead(stream.conversationId);
          void fetchMessages(stream.agentId, stream.conversationId);
        }
        void fetchConversations(stream.agentId);
      } else if (
        stream.status === 'error' &&
        activeAgentIdRef.current === stream.agentId &&
        activeConvIdRef.current === stream.conversationId
      ) {
        setChatError(stream.error || 'Agent error');
      }
    }

    previousStreamStatusRef.current = next;
  }, [chatStreams, fetchConversations, fetchMessages]);

  // While a run is active, periodically refresh messages so API-posted
  // progress/final updates appear even if stream chunks are sparse.
  useEffect(() => {
    if (!activeStream) return;

    const { agentId, conversationId } = activeStream;
    void fetchMessages(agentId, conversationId);

    const intervalId = window.setInterval(() => {
      void fetchMessages(agentId, conversationId);
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeStream, fetchMessages]);

  /* ── Scroll to bottom ── */
  const scrollToBottom = useCallback(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText, scrollToBottom]);

  useEffect(() => {
    if (!activeConvId) return;
    markAgentChatConversationRead(activeConvId);
  }, [activeConvId]);

  /* ── Select conversation ── */
  async function selectConversation(agentId: string, convId: string) {
    if (agentId === activeAgentId && convId === activeConvId) return;
    setActiveAgentId(agentId);
    setActiveConvId(convId);
    setMessages([]);
    setChatError(null);
    markAgentChatConversationRead(convId);
    await fetchMessages(agentId, convId);
    inputRef.current?.focus();
  }

  /* ── Create conversation ── */
  async function createConversation(agentId: string) {
    try {
      const conv = await api<ChatConversation>(
        `/agents/${agentId}/chat/conversations`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setConvsByAgent((prev) => ({
        ...prev,
        [agentId]: [conv, ...(prev[agentId] || [])],
      }));
      setActiveAgentId(agentId);
      setActiveConvId(conv.id);
      setMessages([]);
      isFirstMessageRef.current = true;
      setChatError(null);
      inputRef.current?.focus();
    } catch {
      setChatError('Failed to create conversation');
    }
  }

  /* ── Delete conversation ── */
  async function deleteConversation(agentId: string, convId: string) {
    try {
      await api(`/agents/${agentId}/chat/conversations/${convId}`, { method: 'DELETE' });
      setConvsByAgent((prev) => {
        const next = (prev[agentId] || []).filter((c) => c.id !== convId);
        return { ...prev, [agentId]: next };
      });
      if (convId === activeConvId) {
        const remaining = (convsByAgent[agentId] || []).filter((c) => c.id !== convId);
        if (remaining.length > 0) {
          setActiveConvId(remaining[0].id);
          fetchMessages(agentId, remaining[0].id);
        } else {
          setActiveConvId(null);
          setMessages([]);
        }
      }
    } catch {
      setChatError('Failed to delete conversation');
    }
  }

  /* ── Send message (SSE streaming) ── */
  async function sendMessage() {
    const prompt = input.trim();
    if (!prompt || streaming || !activeAgentId || !activeConvId) return;

    const sentAgentId = activeAgentId;
    const sentConvId = activeConvId;

    setInput('');
    setChatError(null);

    const wasFirst = isFirstMessageRef.current;
    isFirstMessageRef.current = false;

    // Optimistic user message
    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      direction: 'outbound',
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      await startAgentChatStream({
        agentId: sentAgentId,
        conversationId: sentConvId,
        prompt,
      });

      // Refetch conversations to pick up auto-title
      if (wasFirst && sentAgentId) {
        void fetchConversations(sentAgentId);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  /* ── Agent CRUD ── */
  const selectedModel = MODELS.find((m) => m.id === form.model);
  const selectedCli = cliStatus.find((c) => c.id === form.model);
  const cliMissing = selectedCli ? !selectedCli.installed : false;
  const selectedKey = apiKeys.find((k) => k.id === form.apiKeyId);

  function openCreate() {
    setForm(makeEmptyForm());
    setFormErrors({});
    setCreateOpen(true);
    // Fetch supporting data
    (async () => {
      setApiKeysLoading(true);
      try {
        const data = await api<ApiKeysResponse>('/api-keys?limit=100');
        setApiKeys(data.entries.filter((k) => k.isActive));
      } catch { /* empty */ } finally { setApiKeysLoading(false); }
    })();
    (async () => {
      try {
        const data = await api<{ presets: Preset[] }>('/agents/presets');
        setPresets(data.presets);
      } catch { /* empty */ }
    })();
    (async () => {
      try {
        const data = await api<{ clis: CliInfo[] }>('/agents/cli-status');
        setCliStatus(data.clis);
      } catch { /* empty */ }
    })();
  }

  function closeCreate() {
    setCreateOpen(false);
    setForm(makeEmptyForm());
    setFormErrors({});
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    if (form.newKey) {
      if (form.newKeyPermissions.length === 0) errors.permissions = 'Select at least one permission';
    } else {
      if (!form.apiKeyId) errors.apiKeyId = 'Select an API key';
    }
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const model = MODELS.find((m) => m.id === form.model)!;
    let keyId: string;

    if (form.newKey) {
      const agentName = form.name.trim();
      setCreating(true);
      try {
        const created = await api<{ id: string }>('/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${agentName} Key`,
            description: `Auto-created for agent "${agentName}"`,
            permissions: form.newKeyPermissions,
          }),
        });
        keyId = created.id;
      } catch {
        setFormErrors({ permissions: 'Failed to create API key' });
        setCreating(false);
        return;
      }
    } else {
      keyId = form.apiKeyId;
    }

    setCreating(true);
    try {
      const newAgent = await api<Agent>('/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || `${model.name} agent`,
          model: model.name,
          preset: form.preset,
          apiKeyId: keyId,
          skipPermissions: form.skipPermissions,
          avatarIcon: form.avatar.icon,
          avatarBgColor: form.avatar.bgColor,
          avatarLogoColor: form.avatar.logoColor,
        }),
      });
      setAgents((prev) => [...prev, newAgent]);
      // Auto-create first conversation for the new agent
      try {
        const conv = await api<ChatConversation>(
          `/agents/${newAgent.id}/chat/conversations`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        setConvsByAgent((prev) => ({ ...prev, [newAgent.id]: [conv] }));
        setActiveAgentId(newAgent.id);
        setActiveConvId(conv.id);
        setMessages([]);
        isFirstMessageRef.current = true;
      } catch {
        setConvsByAgent((prev) => ({ ...prev, [newAgent.id]: [] }));
        setActiveAgentId(newAgent.id);
        setActiveConvId(null);
      }
      closeCreate();
    } catch (err) {
      setFormErrors({ name: err instanceof ApiError ? err.message : 'Failed to create agent' });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(agent: Agent) {
    const newStatus = agent.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await api<Agent>(`/agents/${agent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? updated : a)));
      if (settingsAgent?.id === agent.id) setSettingsAgent(updated);
    } catch {
      // silently fail
    }
  }

  async function handleToggleSkipPermissions(agent: Agent) {
    try {
      const updated = await api<Agent>(`/agents/${agent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ skipPermissions: !agent.skipPermissions }),
      });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? updated : a)));
      if (settingsAgent?.id === agent.id) setSettingsAgent(updated);
    } catch {
      // silently fail
    }
  }

  async function handleDelete(id: string) {
    try {
      await api(`/agents/${id}`, { method: 'DELETE' });
      setAgents((prev) => prev.filter((a) => a.id !== id));
      setConvsByAgent((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeAgentId === id) {
        setActiveAgentId(null);
        setActiveConvId(null);
        setMessages([]);
      }
      setDeletingId(null);
      setSettingsAgent(null);
    } catch {
      // silently fail
    }
  }

  /* ── Derived data ── */
  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? null;
  const filteredAgents = search.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : agents;

  /* ══════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════ */

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* ── Left sidebar ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>Agents</span>
            <Tooltip label="Add agent">
              <button className={styles.addAgentBtn} onClick={openCreate} aria-label="Add agent">
                <Plus size={16} />
              </button>
            </Tooltip>
          </div>

          <div className={styles.searchRow}>
            <div className={styles.searchWrap}>
              <Search size={14} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="Search agents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.agentList}>
            {loading ? (
              <div className={styles.sidebarEmpty}>Loading agents...</div>
            ) : filteredAgents.length === 0 ? (
              <div className={styles.sidebarEmpty}>
                {search ? 'No agents match your search' : 'No agents yet'}
              </div>
            ) : (
              filteredAgents.map((agent) => {
                const convs = convsByAgent[agent.id] || [];
                return (
                  <div key={agent.id} className={styles.agentGroup}>
                    {/* Agent header row */}
                    <div
                      className={styles.agentGroupHeader}
                      onClick={() => {
                        // Select agent — pick first conv or just select the agent
                        if (convs.length > 0) {
                          selectConversation(agent.id, convs[0].id);
                        } else {
                          setActiveAgentId(agent.id);
                          setActiveConvId(null);
                          setMessages([]);
                        }
                      }}
                    >
                      <AgentAvatar
                        icon={agent.avatarIcon || 'spark'}
                        bgColor={agent.avatarBgColor || '#1a1a2e'}
                        logoColor={agent.avatarLogoColor || '#e94560'}
                        size={36}
                      />
                      <div className={styles.agentGroupInfo}>
                        <div className={styles.agentGroupName}>{agent.name}</div>
                        <div className={styles.agentGroupMeta}>
                          {agent.model} · {convs.length} chat{convs.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div className={styles.agentGroupActions}>
                        <Tooltip label="Settings">
                          <button
                            className={styles.agentGroupIconBtn}
                            onClick={(e) => { e.stopPropagation(); setSettingsAgent(agent); }}
                            aria-label="Agent settings"
                          >
                            <Settings size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label="New chat">
                          <button
                            className={styles.agentGroupIconBtn}
                            onClick={(e) => { e.stopPropagation(); createConversation(agent.id); }}
                            aria-label="New chat"
                          >
                            <Plus size={14} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Conversations */}
                    {convs.length > 0 && (
                      <div className={styles.convList}>
                        {convs.map((conv) => {
                          const isStreaming = streamingConversationIds.has(conv.id);
                          const isUnread = unreadConvIds.has(conv.id);
                          return (
                          <div
                            key={conv.id}
                            className={`${styles.convItem} ${
                              activeAgentId === agent.id && activeConvId === conv.id
                                ? styles.convItemActive
                                : ''
                            }`}
                            onClick={() => selectConversation(agent.id, conv.id)}
                          >
                            {isStreaming && (
                              <span className={styles.convStreamingDot} title="Agent is responding..." />
                            )}
                            {!isStreaming && isUnread && (
                              <span className={styles.convUnreadDot} title="New response" />
                            )}
                            <div className={styles.convItemInfo}>
                              <div className={styles.convItemTitle}>
                                {conv.subject || 'New conversation'}
                              </div>
                            </div>
                            <span className={styles.convItemTime}>
                              {relativeTime(conv.lastMessageAt || conv.createdAt)}
                            </span>
                            <button
                              className={styles.convItemDelete}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteConversation(agent.id, conv.id);
                              }}
                              aria-label="Delete conversation"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          );
                        })}
                        <button
                          className={styles.newConvBtn}
                          onClick={() => createConversation(agent.id)}
                        >
                          <Plus size={13} />
                          New chat
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right panel: Chat ── */}
        <div className={styles.chatPanel}>
          {activeAgent && activeConvId ? (
            <>
              {/* Chat header */}
              <div className={styles.chatHeader}>
                <div className={styles.chatHeaderInfo}>
                  <AgentAvatar
                    icon={activeAgent.avatarIcon || 'spark'}
                    bgColor={activeAgent.avatarBgColor || '#1a1a2e'}
                    logoColor={activeAgent.avatarLogoColor || '#e94560'}
                    size={32}
                  />
                  <span className={styles.chatHeaderName}>{activeAgent.name}</span>
                  <span className={styles.chatHeaderModel}>{activeAgent.model}</span>
                </div>
                <div className={styles.chatHeaderActions}>
                  <div className={styles.chatTabs}>
                    <button
                      className={`${styles.chatTabBtn} ${chatTab === 'chat' ? styles.chatTabBtnActive : ''}`}
                      onClick={() => setChatTab('chat')}
                    >
                      <MessageSquare size={14} />
                      Chat
                    </button>
                    <button
                      className={`${styles.chatTabBtn} ${chatTab === 'files' ? styles.chatTabBtnActive : ''}`}
                      onClick={() => setChatTab('files')}
                    >
                      <FolderOpen size={14} />
                      Files
                    </button>
                  </div>
                  <Tooltip label="Agent settings">
                    <button
                      className={styles.iconBtn}
                      onClick={() => setSettingsAgent(activeAgent)}
                      aria-label="Agent settings"
                    >
                      <Settings size={15} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              {chatTab === 'files' ? (
                <AgentFiles agentId={activeAgent.id} />
              ) : (
              <>
              {/* Error banner */}
              {chatError && <div className={styles.errorBanner}>{chatError}</div>}

              {/* Messages */}
              {messages.length === 0 && !streaming ? (
                <div className={styles.emptyPanel}>
                  <MessageSquare size={36} strokeWidth={1.5} className={styles.emptyIcon} />
                  <div className={styles.emptyTitle}>Start a conversation</div>
                  <div className={styles.emptyText}>
                    Send a message to begin chatting with {activeAgent.name}
                  </div>
                </div>
              ) : (
                <div className={styles.messagesArea} ref={messagesRef}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`${styles.messageRow} ${
                        msg.direction === 'outbound' ? styles.messageRowUser : styles.messageRowAgent
                      }`}
                    >
                      <div className={styles.messageContent}>
                        <div
                          className={`${styles.messageBubble} ${
                            msg.direction === 'outbound'
                              ? styles.messageBubbleUser
                              : styles.messageBubbleAgent
                          }`}
                        >
                          {msg.direction === 'inbound' ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                code({ className, children, ...props }) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  const code = String(children).replace(/\n$/, '');
                                  return match ? (
                                    <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
                                      {code}
                                    </SyntaxHighlighter>
                                  ) : (
                                    <code className={className} {...props}>{children}</code>
                                  );
                                },
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          ) : (
                            msg.content
                          )}
                        </div>
                        <div
                          className={`${styles.messageMeta} ${
                            msg.direction === 'outbound' ? styles.messageMetaUser : ''
                          }`}
                        >
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {msg.direction === 'inbound' && (
                            <button
                              className={styles.copyBtn}
                              onClick={() => {
                                navigator.clipboard.writeText(msg.content);
                                setCopiedId(msg.id);
                                setTimeout(() => setCopiedId(null), 1500);
                              }}
                              aria-label="Copy message"
                            >
                              {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Streaming bubble */}
                  {streaming && streamText && (
                    <div className={`${styles.messageRow} ${styles.messageRowAgent}`}>
                      <div className={styles.messageContent}>
                        <div className={`${styles.messageBubble} ${styles.messageBubbleAgent} ${styles.streamingCursor}`}>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({ className, children, ...props }) {
                                const match = /language-(\w+)/.exec(className || '');
                                const code = String(children).replace(/\n$/, '');
                                return match ? (
                                  <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
                                    {code}
                                  </SyntaxHighlighter>
                                ) : (
                                  <code className={className} {...props}>{children}</code>
                                );
                              },
                            }}
                          >
                            {streamText}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}

                  {streaming && !streamText && (
                    <div className={`${styles.messageRow} ${styles.messageRowAgent}`}>
                      <div className={styles.messageContent}>
                        <div className={`${styles.messageBubble} ${styles.messageBubbleAgent} ${styles.streamingCursor}`}>
                          &nbsp;
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Reply box */}
              <div className={styles.replyBox}>
                <div className={styles.replyRow}>
                  <textarea
                    ref={inputRef}
                    className={styles.replyInput}
                    placeholder="Type a message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={streaming}
                  />
                  <button
                    className={styles.sendBtn}
                    onClick={sendMessage}
                    disabled={streaming || !input.trim()}
                    aria-label="Send message"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
              </>
              )}
            </>
          ) : activeAgent && !activeConvId ? (
            <div className={styles.emptyPanel}>
              <MessageSquare size={36} strokeWidth={1.5} className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>No conversations yet</div>
              <div className={styles.emptyText}>
                Start your first chat with {activeAgent.name}
              </div>
              <Button size="sm" onClick={() => createConversation(activeAgent.id)}>
                <Plus size={14} />
                New chat
              </Button>
            </div>
          ) : (
            <div className={styles.emptyPanel}>
              <MessageSquare size={36} strokeWidth={1.5} className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>
                {agents.length === 0 ? 'No agents yet' : 'Select a conversation'}
              </div>
              <div className={styles.emptyText}>
                {agents.length === 0
                  ? 'Create your first agent to start chatting'
                  : 'Choose an agent and conversation from the sidebar'}
              </div>
              {agents.length === 0 && (
                <Button size="sm" onClick={openCreate}>
                  <Plus size={14} />
                  Add Agent
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Create Agent Modal ── */}
      {createOpen && (
        <div className={styles.modalOverlay} onClick={closeCreate}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Add Agent</h3>
              <button className={styles.modalCloseBtn} onClick={closeCreate}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.modalBody}>
                <Input
                  label="Name"
                  placeholder="e.g. Workflow Assistant"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  error={formErrors.name}
                  autoFocus
                />

                <div>
                  <div className={styles.fieldLabel}>Avatar</div>
                  <AgentAvatarPicker
                    value={form.avatar}
                    onChange={(avatar) => setForm((f) => ({ ...f, avatar }))}
                  />
                </div>

                <Textarea
                  label="Description"
                  placeholder="What does this agent do?"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />

                {presets.length > 0 && (
                  <div>
                    <div className={styles.fieldLabel}>Preset</div>
                    <div className={styles.presetGrid}>
                      {presets.map((preset) => (
                        <div
                          key={preset.id}
                          className={[
                            styles.presetCard,
                            form.preset === preset.id && styles.presetCardSelected,
                          ].filter(Boolean).join(' ')}
                          onClick={() => setForm((f) => ({ ...f, preset: preset.id }))}
                        >
                          <div className={styles.presetName}>{preset.name}</div>
                          <div className={styles.presetDescription}>{preset.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className={styles.fieldLabel}>Model</div>
                  <div className={styles.modelGrid}>
                    {MODELS.map((model) => (
                      <div
                        key={model.id}
                        className={[
                          styles.modelCard,
                          form.model === model.id && styles.modelCardSelected,
                        ].filter(Boolean).join(' ')}
                        onClick={() => setForm((f) => ({ ...f, model: model.id }))}
                      >
                        <div className={styles.modelName}>{model.name}</div>
                        <div className={styles.modelVendor}>{model.vendor}</div>
                        <div className={styles.modelDescription}>{model.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {cliMissing && selectedCli && (
                  <div className={styles.cliBanner}>
                    <div className={styles.cliBannerIcon}>
                      <AlertTriangle size={16} />
                    </div>
                    <div className={styles.cliBannerContent}>
                      <div className={styles.cliBannerTitle}>
                        {selectedModel?.name} CLI not installed
                      </div>
                      <div className={styles.cliBannerText}>
                        The <code>{selectedCli.command}</code> command was not found on this server.
                        Agents using {selectedModel?.name} require the CLI to be installed.
                      </div>
                      <a
                        href={selectedCli.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.cliBannerLink}
                      >
                        <Download size={13} />
                        Download {selectedModel?.name} CLI
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                )}

                <div className={styles.skipPermissionsCard}>
                  <label className={styles.skipPermissionsLabel}>
                    <input
                      type="checkbox"
                      checked={form.skipPermissions}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, skipPermissions: e.target.checked }))
                      }
                    />
                    Enable skip permissions
                  </label>
                  <div className={styles.skipPermissionsHint}>
                    Uses <code className={styles.settingsCode}>{getSkipPermissionsFlag(form.model)}</code>{' '}
                    for {selectedModel?.name || 'this model'}.
                  </div>
                </div>

                <div>
                  <div className={styles.fieldLabel}>API Key</div>
                  <div className={styles.keyModeTabs}>
                    <button
                      type="button"
                      className={`${styles.keyModeTab} ${!form.newKey ? styles.keyModeTabActive : ''}`}
                      onClick={() => setForm((f) => ({ ...f, newKey: false }))}
                    >
                      Use existing
                    </button>
                    <button
                      type="button"
                      className={`${styles.keyModeTab} ${form.newKey ? styles.keyModeTabActive : ''}`}
                      onClick={() => setForm((f) => ({ ...f, newKey: true }))}
                    >
                      <Plus size={13} />
                      Create new
                    </button>
                  </div>

                  {!form.newKey ? (
                    <>
                      <Select
                        value={form.apiKeyId}
                        onChange={(e) => setForm((f) => ({ ...f, apiKeyId: e.target.value }))}
                        error={formErrors.apiKeyId}
                      >
                        <option value="">
                          {apiKeysLoading ? 'Loading keys...' : 'Select an API key'}
                        </option>
                        {apiKeys.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name} ({k.keyPrefix}...)
                          </option>
                        ))}
                      </Select>

                      {selectedKey && (
                        <div className={styles.keyPermissions}>
                          <div className={styles.keyPermissionsLabel}>Permissions from this key</div>
                          <div className={styles.keyPermissionsList}>
                            {selectedKey.permissions.map((perm) => (
                              <Badge key={perm} color="info">{perm}</Badge>
                            ))}
                            {selectedKey.permissions.length === 0 && (
                              <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                                No permissions configured
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {apiKeys.length === 0 && !apiKeysLoading && (
                        <div className={styles.noKeysHint}>
                          No active API keys. Switch to "Create new" to make one now.
                        </div>
                      )}
                    </>
                  ) : (
                    <ApiKeyFormFields
                      permissionsOnly
                      form={{ name: '', description: '', permissions: form.newKeyPermissions, hasExpiration: false, expiresAt: '' }}
                      onChange={(updater) => {
                        setForm((f) => {
                          const next = updater({ name: '', description: '', permissions: f.newKeyPermissions, hasExpiration: false, expiresAt: '' });
                          return { ...f, newKeyPermissions: next.permissions };
                        });
                      }}
                      errors={{ permissions: formErrors.permissions }}
                    />
                  )}
                </div>
              </div>
              <div className={styles.modalFooter}>
                <Button type="button" variant="secondary" size="md" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Agent'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Agent Settings Modal ── */}
      {settingsAgent && (
        <div className={styles.modalOverlay} onClick={() => { setSettingsAgent(null); setDeletingId(null); }}>
          <div className={styles.settingsModalWide} onClick={(e) => e.stopPropagation()}>
            {/* Hero header with avatar, name, status */}
            <div className={styles.settingsHero}>
              <AgentAvatar
                icon={settingsAgent.avatarIcon || 'spark'}
                bgColor={settingsAgent.avatarBgColor || '#1a1a2e'}
                logoColor={settingsAgent.avatarLogoColor || '#e94560'}
                size={56}
              />
              <div className={styles.settingsHeroInfo}>
                <h3 className={styles.settingsHeroName}>{settingsAgent.name}</h3>
                <p className={styles.settingsHeroDesc}>{settingsAgent.description}</p>
              </div>
              <div className={styles.settingsHeroRight}>
                <Badge color={STATUS_COLOR[settingsAgent.status]}>
                  <span
                    className={`${styles.statusDot} ${
                      settingsAgent.status === 'active'
                        ? styles.statusDotActive
                        : settingsAgent.status === 'error'
                          ? styles.statusDotError
                          : styles.statusDotInactive
                    }`}
                  />
                  {STATUS_LABEL[settingsAgent.status]}
                </Badge>
              </div>
              <button className={styles.modalCloseBtn} onClick={() => { setSettingsAgent(null); setDeletingId(null); }}>
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Configuration section */}
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>Configuration</div>
                <div className={styles.settingsGrid}>
                  <div className={styles.settingsGridItem}>
                    <div className={styles.settingsGridLabel}>
                      <Terminal size={13} />
                      Model
                    </div>
                    <div className={styles.settingsGridValue}>{settingsAgent.model}</div>
                  </div>
                  <div className={styles.settingsGridItem}>
                    <div className={styles.settingsGridLabel}>
                      <Key size={13} />
                      API Key
                    </div>
                    <div className={styles.settingsGridValue}>
                      {settingsAgent.apiKeyName}{' '}
                      <code className={styles.settingsCode}>{settingsAgent.apiKeyPrefix}...</code>
                    </div>
                  </div>
                  <div className={styles.settingsGridItem}>
                    <div className={styles.settingsGridLabel}>Skip permissions</div>
                    <div className={styles.settingsGridValue}>
                      {settingsAgent.skipPermissions ? 'Enabled' : 'Disabled'}
                      <code className={styles.settingsCode}>{getSkipPermissionsFlag(settingsAgent.model)}</code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Capabilities section */}
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>Capabilities</div>
                <div className={styles.capsList}>
                  {settingsAgent.capabilities.map((cap) => (
                    <Badge key={cap} color="info">{cap}</Badge>
                  ))}
                  {settingsAgent.capabilities.length === 0 && (
                    <span className={styles.settingsEmpty}>No capabilities assigned</span>
                  )}
                </div>
              </div>

              {/* Activity section */}
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>Activity</div>
                <div className={styles.settingsGrid}>
                  <div className={styles.settingsGridItem}>
                    <div className={styles.settingsGridLabel}>Last active</div>
                    <div className={styles.settingsGridValue}>
                      {settingsAgent.lastActivity
                        ? new Date(settingsAgent.lastActivity).toLocaleString()
                        : 'Never'}
                    </div>
                  </div>
                  <div className={styles.settingsGridItem}>
                    <div className={styles.settingsGridLabel}>Created</div>
                    <div className={styles.settingsGridValue}>
                      {new Date(settingsAgent.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className={styles.settingsActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggleSkipPermissions(settingsAgent)}
                >
                  {settingsAgent.skipPermissions
                    ? 'Disable skip permissions'
                    : 'Enable skip permissions'}
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggle(settingsAgent)}
                >
                  {settingsAgent.status === 'active' ? <PowerOff size={13} /> : <Power size={13} />}
                  {settingsAgent.status === 'active' ? 'Disable agent' : 'Enable agent'}
                </Button>

                <div className={styles.settingsActionsSpacer} />

                {deletingId === settingsAgent.id ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setDeletingId(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => handleDelete(settingsAgent.id)}>
                      Confirm Delete
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setDeletingId(settingsAgent.id)}>
                    <Trash2 size={13} />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
