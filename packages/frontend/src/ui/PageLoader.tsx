import styles from './PageLoader.module.css';

export function PageLoader() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.spinner} />
    </div>
  );
}
