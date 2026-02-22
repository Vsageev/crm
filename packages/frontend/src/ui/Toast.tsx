import { X } from 'lucide-react';
import { useToasts, dismissToast } from '../stores/toast';
import styles from './Toast.module.css';

export function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.variant]}`}>
          <span className={styles.message}>{t.message}</span>
          <button
            className={styles.dismiss}
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
