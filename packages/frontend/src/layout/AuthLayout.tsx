import { Outlet } from 'react-router-dom';
import styles from './AuthLayout.module.css';

export function AuthLayout() {
  return (
    <div className={styles.layout}>
      <div className={styles.container}>
        <div className={styles.logo}>CRM</div>
        <Outlet />
      </div>
    </div>
  );
}
