import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { RequireAuth, RequireGuest } from './guards';
import { PageLoader } from '../ui';

// Auth pages — small, loaded eagerly for fast initial paint
import { LoginPage, RegisterPage } from '../pages/auth';

// Lazy-loaded app pages — code-split per route
const DashboardPage = lazy(() =>
  import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const CollectionsListPage = lazy(() =>
  import('../pages/collections/CollectionsListPage').then((m) => ({ default: m.CollectionsListPage })),
);
const CollectionDetailPage = lazy(() =>
  import('../pages/collections/CollectionDetailPage').then((m) => ({ default: m.CollectionDetailPage })),
);
const BoardsListPage = lazy(() =>
  import('../pages/boards/BoardsListPage').then((m) => ({ default: m.BoardsListPage })),
);
const BoardPage = lazy(() =>
  import('../pages/boards/BoardPage').then((m) => ({ default: m.BoardPage })),
);
const CardDetailPage = lazy(() =>
  import('../pages/cards/CardDetailPage').then((m) => ({ default: m.CardDetailPage })),
);
const InboxPage = lazy(() =>
  import('../pages/inbox/InboxPage').then((m) => ({ default: m.InboxPage })),
);
const SettingsPage = lazy(() =>
  import('../pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AgentsPage = lazy(() =>
  import('../pages/AgentsPage').then((m) => ({ default: m.AgentsPage })),
);
const AgentMonitorPage = lazy(() =>
  import('../pages/AgentMonitorPage').then((m) => ({ default: m.AgentMonitorPage })),
);
const StoragePage = lazy(() =>
  import('../pages/StoragePage').then((m) => ({ default: m.StoragePage })),
);
const NotFoundPage = lazy(() =>
  import('../pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);
const MyCardsPage = lazy(() =>
  import('../pages/MyCardsPage').then((m) => ({ default: m.MyCardsPage })),
);
const AuthLayout = lazy(() =>
  import('../layout/AuthLayout').then((m) => ({ default: m.AuthLayout })),
);
const AppLayout = lazy(() =>
  import('../layout/AppLayout').then((m) => ({ default: m.AppLayout })),
);

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // Guest-only routes (login, register)
      {
        element: <RequireGuest />,
        children: [
          {
            element: <SuspenseWrapper><AuthLayout /></SuspenseWrapper>,
            children: [
              { path: 'login', element: <LoginPage /> },
              { path: 'register', element: <RegisterPage /> },
            ],
          },
        ],
      },
      // Authenticated routes
      {
        element: <RequireAuth />,
        children: [
          {
            element: <SuspenseWrapper><AppLayout /></SuspenseWrapper>,
            children: [
              { index: true, element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper> },
              { path: 'collections', element: <SuspenseWrapper><CollectionsListPage /></SuspenseWrapper> },
              { path: 'collections/:id', element: <SuspenseWrapper><CollectionDetailPage /></SuspenseWrapper> },
              { path: 'cards/:id', element: <SuspenseWrapper><CardDetailPage /></SuspenseWrapper> },
              { path: 'boards', element: <SuspenseWrapper><BoardsListPage /></SuspenseWrapper> },
              { path: 'boards/:id', element: <SuspenseWrapper><BoardPage /></SuspenseWrapper> },
              { path: 'inbox', element: <SuspenseWrapper><InboxPage /></SuspenseWrapper> },
              { path: 'agents', element: <SuspenseWrapper><AgentsPage /></SuspenseWrapper> },
              { path: 'monitor', element: <SuspenseWrapper><AgentMonitorPage /></SuspenseWrapper> },
              { path: 'storage', element: <SuspenseWrapper><StoragePage /></SuspenseWrapper> },
              { path: 'settings', element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
              { path: 'my-cards', element: <SuspenseWrapper><MyCardsPage /></SuspenseWrapper> },
            ],
          },
        ],
      },
      // 404 catch-all
      { path: '*', element: <SuspenseWrapper><NotFoundPage /></SuspenseWrapper> },
    ],
  },
]);
