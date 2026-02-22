import { Link } from 'react-router-dom';
import { Button } from '../ui';

export function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center', paddingTop: 120 }}>
      <h1 style={{ fontSize: 48, fontWeight: 600, marginBottom: 8 }}>404</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>Page not found</p>
      <Link to="/">
        <Button variant="secondary">Go to Dashboard</Button>
      </Link>
    </div>
  );
}
