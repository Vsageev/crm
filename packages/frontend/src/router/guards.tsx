import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../stores/useAuth';
import { PageLoader } from '../ui';

export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

export function RequireGuest() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (user) return <Navigate to="/" replace />;

  return <Outlet />;
}
