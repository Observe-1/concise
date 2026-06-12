import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './api/queries.js';
import { Layout } from './components/Layout.js';
import { Spinner } from './components/ui.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { HoldingsPage } from './pages/HoldingsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { RecurringPage } from './pages/RecurringPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index path="/" element={<DashboardPage />} />
        <Route path="/assets" element={<HoldingsPage kind="assets" />} />
        <Route path="/liabilities" element={<HoldingsPage kind="liabilities" />} />
        <Route path="/recurring" element={<RecurringPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
