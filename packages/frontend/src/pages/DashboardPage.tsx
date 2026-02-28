import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderOpen,
  Kanban,
  FileText,
  ArrowRight,
} from 'lucide-react';
import { PageHeader } from '../layout';
import { useAuth } from '../stores/useAuth';
import { api } from '../lib/api';
import styles from './DashboardPage.module.css';

interface CardItem {
  id: string;
  name: string;
  description: string | null;
  folderId: string;
  createdAt: string;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ folders: 0, boards: 0, cards: 0 });
  const [recentCards, setRecentCards] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [foldersRes, boardsRes, cardsRes] =
        await Promise.all([
          api<{ total: number }>('/folders?limit=0'),
          api<{ total: number }>('/boards?limit=0'),
          api<{ entries: CardItem[]; total: number }>('/cards?limit=8'),
        ]);

      setStats({
        folders: foldersRes.total,
        boards: boardsRes.total,
        cards: cardsRes.total,
      });
      setRecentCards(cardsRes.entries);
    } catch {
      // silently handle — dashboard is best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const greeting = user ? `Welcome back, ${user.firstName}` : 'Dashboard';

  return (
    <div className={styles.wrapper}>
      <PageHeader title={greeting} description="Overview of your workspace" />

      {loading ? (
        <div className={styles.loadingState}>Loading dashboard...</div>
      ) : (
        <>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-info)' }}
              >
                <FolderOpen size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.folders}</div>
                <div className={styles.statLabel}>Collections</div>
              </div>
            </div>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(139,92,246,0.1)', color: '#8B5CF6' }}
              >
                <Kanban size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.boards}</div>
                <div className={styles.statLabel}>Boards</div>
              </div>
            </div>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)' }}
              >
                <FileText size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.cards}</div>
                <div className={styles.statLabel}>Cards</div>
              </div>
            </div>
          </div>

          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Recent Cards</h2>
                <Link to="/folders" className={styles.viewAllLink}>
                  View all <ArrowRight size={14} />
                </Link>
              </div>
              {recentCards.length === 0 ? (
                <div className={styles.emptyState}>No cards yet</div>
              ) : (
                <div className={styles.taskList}>
                  {recentCards.map((card) => (
                    <Link
                      key={card.id}
                      to={`/cards/${card.id}`}
                      className={styles.taskItem}
                    >
                      <div className={styles.taskInfo}>
                        <div className={styles.taskTitle}>{card.name}</div>
                        {card.description && (
                          <div className={styles.taskDue}>{card.description}</div>
                        )}
                      </div>
                      <span className={styles.taskStatus}>
                        {new Date(card.createdAt).toLocaleDateString()}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
