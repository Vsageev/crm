import { Outlet } from 'react-router-dom';
import { AuthProvider } from '../stores/auth';
import { ToastContainer } from '../ui/Toast';
import { ErrorBoundary } from '../ui/ErrorBoundary';

export function RootLayout() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
      <ToastContainer />
    </AuthProvider>
  );
}
