import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Code,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './QuizzesListPage.module.css';

interface Quiz {
  id: string;
  name: string;
  description?: string | null;
  status: 'draft' | 'active' | 'inactive' | 'archived';
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  createdAt: string;
}

interface QuizzesResponse {
  total: number;
  limit: number;
  offset: number;
  entries: Quiz[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  draft: 'default',
  active: 'success',
  inactive: 'warning',
  archived: 'error',
};

const PAGE_SIZE = 25;

export function QuizzesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [embedQuizId, setEmbedQuizId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';

  const fetchQuizzes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const data = await api<QuizzesResponse>(`/quizzes?${params}`);
      setQuizzes(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load quizzes');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchQuizzes();
  }, [fetchQuizzes]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (searchInput) next.set('search', searchInput);
      else next.delete('search');
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
      if (value) next.set(key, value);
      else next.delete(key);
      next.set('page', '1');
      return next;
    });
  }

  async function handleDelete(quiz: Quiz) {
    if (!window.confirm(`Delete quiz "${quiz.name}"? This cannot be undone.`)) return;
    try {
      await api(`/quizzes/${quiz.id}`, { method: 'DELETE' });
      setQuizzes((prev) => prev.filter((q) => q.id !== quiz.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete quiz');
    }
  }

  function getEmbedCode(quizId: string) {
    const url = `${window.location.origin}/quiz/${quizId}`;
    return `<iframe src="${url}" width="100%" height="700" frameborder="0" style="border:none;border-radius:12px;"></iframe>`;
  }

  function getDirectLink(quizId: string) {
    return `${window.location.origin}/quiz/${quizId}?preview=1`;
  }

  async function handleCopyEmbed() {
    if (!embedQuizId) return;
    try {
      await navigator.clipboard.writeText(getEmbedCode(embedQuizId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div>
      <PageHeader
        title="Quizzes"
        description="Interactive quiz funnels for lead generation"
        actions={
          <Link to="/quizzes/new">
            <Button size="md">
              <Plus size={16} />
              Create Quiz
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
                placeholder="Search quizzes..."
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
            value={statusFilter}
            onChange={(e) => setFilter('status', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>

          <div className={styles.meta}>
            {!loading && (
              <span className={styles.count}>
                {total} quiz{total !== 1 ? 'zes' : ''}
              </span>
            )}
          </div>
        </div>

        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.emptyState}>Loading quizzes...</div>
        ) : quizzes.length === 0 ? (
          <div className={styles.emptyState}>
            {search || statusFilter ? (
              <>
                <p>No quizzes match your filters.</p>
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
                <p>No quizzes yet.</p>
                <Link to="/quizzes/new">
                  <Button size="sm">
                    <Plus size={14} />
                    Create your first quiz
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
                    <th>Status</th>
                    <th>Sessions</th>
                    <th>Completion</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {quizzes.map((quiz) => (
                    <tr key={quiz.id}>
                      <td>
                        <Link to={`/quizzes/${quiz.id}/edit`} className={styles.nameCell}>
                          {quiz.name}
                        </Link>
                      </td>
                      <td>
                        <Badge color={STATUS_COLORS[quiz.status] ?? 'default'}>
                          {quiz.status}
                        </Badge>
                      </td>
                      <td className={styles.statsCell}>
                        {quiz.completedSessions} / {quiz.totalSessions}
                      </td>
                      <td className={styles.statsCell}>{quiz.completionRate}%</td>
                      <td className={styles.dateCell}>
                        {new Date(quiz.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div className={styles.actionsCell}>
                          <Link
                            to={`/quizzes/${quiz.id}/edit`}
                            className={styles.actionBtn}
                            title="Edit quiz"
                          >
                            <Pencil size={14} />
                          </Link>
                          <button
                            className={`${styles.actionBtn} ${styles.embedBtn}`}
                            onClick={() => setEmbedQuizId(quiz.id)}
                            title="Embed code"
                          >
                            <Code size={14} />
                          </button>
                          <a
                            href={getDirectLink(quiz.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.actionBtn}
                            title="Open quiz"
                          >
                            <ExternalLink size={14} />
                          </a>
                          <button
                            className={`${styles.actionBtn} ${styles.deleteBtn}`}
                            onClick={() => handleDelete(quiz)}
                            title="Delete quiz"
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

      {/* Embed Code Modal */}
      {embedQuizId && (
        <div className={styles.embedModal} onClick={() => setEmbedQuizId(null)}>
          <div className={styles.embedModalContent} onClick={(e) => e.stopPropagation()}>
            <h3>Embed Quiz</h3>

            <label>Direct Link</label>
            <textarea
              className={styles.embedCode}
              readOnly
              rows={1}
              value={getDirectLink(embedQuizId)}
            />

            <label>Iframe Embed Code</label>
            <textarea
              className={styles.embedCode}
              readOnly
              rows={3}
              value={getEmbedCode(embedQuizId)}
            />

            <div className={styles.embedActions}>
              <Button variant="secondary" size="sm" onClick={() => setEmbedQuizId(null)}>
                Close
              </Button>
              <Button size="sm" onClick={handleCopyEmbed}>
                <Copy size={14} />
                {copied ? 'Copied!' : 'Copy Embed Code'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
