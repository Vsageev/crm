import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Building2,
  Kanban,
  CheckSquare,
  MessageSquare,
  Zap,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../stores/useAuth';
import styles from './Sidebar.module.css';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/companies', icon: Building2, label: 'Companies' },
  { to: '/deals', icon: Kanban, label: 'Deals' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
  { to: '/automation', icon: Zap, label: 'Automation' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
] as const;

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>CRM</div>
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
                <span className={styles.userRole}>{user.role}</span>
              </div>
            </div>
            <button
              className={styles.logoutBtn}
              onClick={logout}
              title="Log out"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
