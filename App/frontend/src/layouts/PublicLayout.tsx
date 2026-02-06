import { Outlet } from 'react-router-dom';
import { useSystemTheme } from '../hooks/useSystemTheme';

export default function PublicLayout() {
  // Public pages don't load user settings; keep theme in sync with OS preference.
  useSystemTheme();
  return <Outlet />;
}
