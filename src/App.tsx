import { useCallback, useEffect, useState } from 'react';
import { fetchMe, getToken, setToken } from './api';
import type { AuthUser } from './types';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    fetchMe()
      .then((response) => setUser(response.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  if (checking) return <div className="app-loading">Loading…</div>;

  return user ? <Dashboard user={user} onLogout={handleLogout} /> : <LoginForm onLogin={setUser} />;
}
