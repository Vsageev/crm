import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout, AuthLayout } from '../layout';
import { RootLayout } from './RootLayout';
import { RequireAuth, RequireGuest } from './guards';
import { PageLoader } from '../ui';

// Auth pages — small, loaded eagerly for fast initial paint
import { LoginPage, RegisterPage, TwoFactorSetupPage } from '../pages/auth';

// Lazy-loaded app pages — code-split per route
const DashboardPage = lazy(() =>
  import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const ContactsListPage = lazy(() =>
  import('../pages/contacts/ContactsListPage').then((m) => ({ default: m.ContactsListPage })),
);
const ContactDetailPage = lazy(() =>
  import('../pages/contacts/ContactDetailPage').then((m) => ({ default: m.ContactDetailPage })),
);
const ContactFormPage = lazy(() =>
  import('../pages/contacts/ContactFormPage').then((m) => ({ default: m.ContactFormPage })),
);
const CompaniesPage = lazy(() =>
  import('../pages/CompaniesPage').then((m) => ({ default: m.CompaniesPage })),
);
const DealsPage = lazy(() =>
  import('../pages/DealsPage').then((m) => ({ default: m.DealsPage })),
);
const DealDetailPage = lazy(() =>
  import('../pages/deals/DealDetailPage').then((m) => ({ default: m.DealDetailPage })),
);
const TasksListPage = lazy(() =>
  import('../pages/tasks/TasksListPage').then((m) => ({ default: m.TasksListPage })),
);
const TaskDetailPage = lazy(() =>
  import('../pages/tasks/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
const TaskFormPage = lazy(() =>
  import('../pages/tasks/TaskFormPage').then((m) => ({ default: m.TaskFormPage })),
);
const AutomationRulesListPage = lazy(() =>
  import('../pages/automation/AutomationRulesListPage').then((m) => ({
    default: m.AutomationRulesListPage,
  })),
);
const AutomationRuleFormPage = lazy(() =>
  import('../pages/automation/AutomationRuleFormPage').then((m) => ({
    default: m.AutomationRuleFormPage,
  })),
);
const InboxPage = lazy(() =>
  import('../pages/inbox/InboxPage').then((m) => ({ default: m.InboxPage })),
);
const ReportsPage = lazy(() =>
  import('../pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('../pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const NotFoundPage = lazy(() =>
  import('../pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
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
            element: <AuthLayout />,
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
            element: <AuthLayout />,
            children: [
              { path: '2fa/setup', element: <TwoFactorSetupPage /> },
            ],
          },
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper> },
              { path: 'contacts', element: <SuspenseWrapper><ContactsListPage /></SuspenseWrapper> },
              { path: 'contacts/new', element: <SuspenseWrapper><ContactFormPage /></SuspenseWrapper> },
              { path: 'contacts/:id', element: <SuspenseWrapper><ContactDetailPage /></SuspenseWrapper> },
              { path: 'contacts/:id/edit', element: <SuspenseWrapper><ContactFormPage /></SuspenseWrapper> },
              { path: 'companies', element: <SuspenseWrapper><CompaniesPage /></SuspenseWrapper> },
              { path: 'deals', element: <SuspenseWrapper><DealsPage /></SuspenseWrapper> },
              { path: 'deals/:id', element: <SuspenseWrapper><DealDetailPage /></SuspenseWrapper> },
              { path: 'tasks', element: <SuspenseWrapper><TasksListPage /></SuspenseWrapper> },
              { path: 'tasks/new', element: <SuspenseWrapper><TaskFormPage /></SuspenseWrapper> },
              { path: 'tasks/:id', element: <SuspenseWrapper><TaskDetailPage /></SuspenseWrapper> },
              { path: 'tasks/:id/edit', element: <SuspenseWrapper><TaskFormPage /></SuspenseWrapper> },
              { path: 'automation', element: <SuspenseWrapper><AutomationRulesListPage /></SuspenseWrapper> },
              { path: 'automation/new', element: <SuspenseWrapper><AutomationRuleFormPage /></SuspenseWrapper> },
              { path: 'automation/:id/edit', element: <SuspenseWrapper><AutomationRuleFormPage /></SuspenseWrapper> },
              { path: 'inbox', element: <SuspenseWrapper><InboxPage /></SuspenseWrapper> },
              { path: 'reports', element: <SuspenseWrapper><ReportsPage /></SuspenseWrapper> },
              { path: 'settings', element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
            ],
          },
        ],
      },
      // 404 catch-all
      { path: '*', element: <SuspenseWrapper><NotFoundPage /></SuspenseWrapper> },
    ],
  },
]);
