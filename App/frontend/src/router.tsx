import { createBrowserRouter, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import { UnifiedWorkspace } from './pages/UnifiedWorkspace';
import ProtectedLayout from './layouts/ProtectedLayout';
import PublicLayout from './layouts/PublicLayout';

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
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
