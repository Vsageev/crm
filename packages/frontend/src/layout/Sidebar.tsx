import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Kanban,
  MessageSquare,
  Cpu,
  Cable,
  HardDrive,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../stores/useAuth';
import { Tooltip } from '../ui';
import { getPreferredBoardId, getPreferredFolderId } from '../lib/navigation-preferences';
import styles from './Sidebar.module.css';

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();
  const preferredFolderId = getPreferredFolderId();
  const preferredBoardId = getPreferredBoardId();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: preferredFolderId ? `/folders/${preferredFolderId}` : '/folders', icon: FolderOpen, label: 'Collections' },
    { to: preferredBoardId ? `/boards/${preferredBoardId}` : '/boards', icon: Kanban, label: 'Boards' },
    { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
    { to: '/agents', icon: Cpu, label: 'Agents' },
    { to: '/connectors', icon: Cable, label: 'Connectors' },
    { to: '/storage', icon: HardDrive, label: 'Storage' },
  ] as const;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>Cards</div>
      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [styles.navItem, isActive && styles.active].filter(Boolean).join(' ')
            }
            end={item.to === '/'}
            onClick={onNavigate}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className={styles.bottom}>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [styles.navItem, isActive && styles.active].filter(Boolean).join(' ')
          }
          onClick={onNavigate}
        >
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
        {user && (
          <div className={styles.userSection}>
            <div className={styles.userInfo}>
              <span className={styles.userAvatar}>
                {user.firstName[0]}
                {user.lastName[0]}
              </span>
              <div className={styles.userDetails}>
                <span className={styles.userName}>
                  {user.firstName} {user.lastName}
                </span>
              </div>
            </div>
            <Tooltip label="Log out">
              <button
                className={styles.logoutBtn}
                onClick={logout}
              >
                <LogOut size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </aside>
  );
}
