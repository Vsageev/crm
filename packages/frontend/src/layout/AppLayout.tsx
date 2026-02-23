import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Menu, X } from 'lucide-react';
import { PhoneProvider } from '../features/phone';
import { IncomingCallBanner } from '../features/phone/IncomingCallBanner';
import { Tooltip } from '../ui';
import styles from './AppLayout.module.css';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <PhoneProvider>
      <div className={styles.layout}>
        {/* Mobile header */}
        <header className={styles.mobileHeader}>
          <Tooltip label="Open menu" position="right">
            <button
              className={styles.menuBtn}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
          </Tooltip>
          <span className={styles.mobileTitle}>CRM</span>
        </header>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div
            className={styles.overlay}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className={`${styles.sidebarWrap} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <Tooltip label="Close menu" position="right">
            <button
              className={styles.closeSidebarBtn}
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </Tooltip>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>

        <main className={styles.main}>
          <Outlet />
        </main>

        <IncomingCallBanner />
      </div>
    </PhoneProvider>
  );
}
