import { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import { UnifiedWorkspace } from './pages/UnifiedWorkspace';
import ProtectedLayout from './layouts/ProtectedLayout';
import PublicLayout from './layouts/PublicLayout';
import { Loading } from './components/common/Loading';
import { useAuthStore } from './store/authStore';

const AdminPage = lazy(() => import('./pages/Admin'));

function AdminRouteElement() {
  const user = useAuthStore((state) => state.user);

  if (!user?.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Suspense fallback={<Loading fullPage text="Loading admin console..." />}>
      <AdminPage />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      {
        index: true,
        element: <Landing />,
      },
      {
        path: 'login',
        element: <Login />,
      },
      {
        path: 'register',
        element: <Register />,
      },
    ],
  },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      {
        path: 'dashboard',
        element: <Home />,
      },
      {
        path: 'project/:projectId/:subPage?',
        element: <UnifiedWorkspace />,
      },
      {
        path: 'admin',
        element: <AdminRouteElement />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
