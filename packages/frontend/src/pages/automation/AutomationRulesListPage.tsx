import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './AutomationRulesListPage.module.css';

type AutomationTrigger =
  | 'contact_created'
  | 'deal_created'
  | 'deal_stage_changed'
  | 'message_received'
  | 'tag_added'
  | 'task_completed'
  | 'conversation_created';

type AutomationAction =
  | 'assign_agent'
  | 'create_task'
  | 'send_message'
  | 'move_deal'
  | 'add_tag'
  | 'send_notification'
  | 'create_deal';

interface AutomationRule {
  id: string;
  name: string;
  description?: string | null;
  trigger: AutomationTrigger;
  conditions: unknown[];
  action: AutomationAction;
  actionParams: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RulesResponse {
  total: number;
  limit: number;
  offset: number;
  entries: AutomationRule[];
}

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  contact_created: 'Contact Created',
  deal_created: 'Deal Created',
  deal_stage_changed: 'Deal Stage Changed',
  message_received: 'Message Received',
  tag_added: 'Tag Added',
  task_completed: 'Task Completed',
  conversation_created: 'Conversation Created',
};

const TRIGGER_COLORS: Record<AutomationTrigger, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  contact_created: 'info',
  deal_created: 'success',
  deal_stage_changed: 'warning',
  message_received: 'info',
  tag_added: 'default',
  task_completed: 'success',
  conversation_created: 'info',
};

const ACTION_LABELS: Record<AutomationAction, string> = {
  assign_agent: 'Assign Agent',
  create_task: 'Create Task',
  send_message: 'Send Message',
  move_deal: 'Move Deal',
  add_tag: 'Add Tag',
  send_notification: 'Send Notification',
  create_deal: 'Create Deal',
};

const ACTION_COLORS: Record<AutomationAction, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  assign_agent: 'warning',
  create_task: 'info',
  send_message: 'success',
  move_deal: 'warning',
  add_tag: 'default',
  send_notification: 'info',
  create_deal: 'success',
};

const PAGE_SIZE = 25;

export function AutomationRulesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';
  const triggerFilter = searchParams.get('trigger') || '';
  const actionFilter = searchParams.get('action') || '';
  const activeFilter = searchParams.get('isActive') || '';

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (search) params.set('search', search);
      if (triggerFilter) params.set('trigger', triggerFilter);
      if (actionFilter) params.set('action', actionFilter);
      if (activeFilter) params.set('isActive', activeFilter);

      const data = await api<RulesResponse>(`/automation-rules?${params}`);
      setRules(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load automation rules');
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, triggerFilter, actionFilter, activeFilter]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (searchInput) {
        next.set('search', searchInput);
      } else {
        next.delete('search');
      }
      next.set('page', '1');
      return next;
    });
  }

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  }

  function setFilter(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.set('page', '1');
      return next;
    });
  }

  async function handleToggleActive(rule: AutomationRule) {
    try {
      await api(`/automation-rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)),
      );
    } catch {
      // Silently fail — user can retry
    }
  }

  async function handleDelete(rule: AutomationRule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    try {
      await api(`/automation-rules/${rule.id}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to delete rule');
      }
    }
  }

  return (
    <div>
      <PageHeader
        title="Automation Rules"
        description="Create rules to automate your workflow"
        actions={
          <Link to="/automation/new">
            <Button size="md">
              <Plus size={16} />
              Add Rule
            </Button>
          </Link>
        }
      />

      <Card>
        <div className={styles.toolbar}>
          <form onSubmit={handleSearch} className={styles.searchForm}>
            <div className={styles.searchInputWrap}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search rules..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>
        </div>

        <div className={styles.filters}>
          <select
            value={triggerFilter}
            onChange={(e) => setFilter('trigger', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Triggers</option>
            <option value="contact_created">Contact Created</option>
            <option value="deal_created">Deal Created</option>
            <option value="deal_stage_changed">Deal Stage Changed</option>
            <option value="message_received">Message Received</option>
            <option value="tag_added">Tag Added</option>
            <option value="task_completed">Task Completed</option>
            <option value="conversation_created">Conversation Created</option>
          </select>

          <select
            value={actionFilter}
            onChange={(e) => setFilter('action', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Actions</option>
            <option value="assign_agent">Assign Agent</option>
            <option value="create_task">Create Task</option>
            <option value="send_message">Send Message</option>
            <option value="move_deal">Move Deal</option>
            <option value="add_tag">Add Tag</option>
            <option value="send_notification">Send Notification</option>
            <option value="create_deal">Create Deal</option>
          </select>

          <select
            value={activeFilter}
            onChange={(e) => setFilter('isActive', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          <div className={styles.meta}>
            {!loading && (
              <span className={styles.count}>
                {total} rule{total !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.emptyState}>Loading automation rules...</div>
        ) : rules.length === 0 ? (
          <div className={styles.emptyState}>
            {search || triggerFilter || actionFilter || activeFilter ? (
              <>
                <p>No rules match your filters.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput('');
                    setSearchParams({});
                  }}
                >
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p>No automation rules yet.</p>
                <Link to="/automation/new">
                  <Button size="sm">
                    <Plus size={14} />
                    Create your first rule
                  </Button>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Trigger</th>
                    <th>Action</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <Link to={`/automation/${rule.id}/edit`} className={styles.nameCell}>
                          {rule.name}
                        </Link>
                        {rule.description && (
                          <div className={styles.descriptionText}>{rule.description}</div>
                        )}
                      </td>
                      <td>
                        <Badge color={TRIGGER_COLORS[rule.trigger]}>
                          {TRIGGER_LABELS[rule.trigger]}
                        </Badge>
                      </td>
                      <td>
                        <Badge color={ACTION_COLORS[rule.action]}>
                          {ACTION_LABELS[rule.action]}
                        </Badge>
                      </td>
                      <td className={styles.priorityCell}>{rule.priority}</td>
                      <td>
                        <button
                          className={`${styles.toggleBtn} ${rule.isActive ? styles.toggleActive : styles.toggleInactive}`}
                          onClick={() => handleToggleActive(rule)}
                          title={rule.isActive ? 'Deactivate rule' : 'Activate rule'}
                        >
                          {rule.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                        </button>
                      </td>
                      <td className={styles.dateCell}>
                        {new Date(rule.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div className={styles.actionsCell}>
                          <Link
                            to={`/automation/${rule.id}/edit`}
                            className={styles.actionBtn}
                            title="Edit rule"
                          >
                            <Pencil size={14} />
                          </Link>
                          <button
                            className={`${styles.actionBtn} ${styles.deleteBtn}`}
                            onClick={() => handleDelete(rule)}
                            title="Delete rule"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeft size={14} />
                  Previous
                </Button>
                <span className={styles.pageInfo}>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
