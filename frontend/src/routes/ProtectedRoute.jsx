import React from 'react';
import { Redirect, Route } from 'react-router-dom';
import { Logo } from '../components/Icons';
import { Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';

function AuthGate() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
      <Logo className="h-9 w-9" />
      <span className="flex items-center gap-2 text-[13.5px] text-ink-500">
        <Spinner className="h-4 w-4" />
        Restoring your session
      </span>
    </div>
  );
}

/**
 * Route guard. Everything under /app requires a Supabase session, so an
 * unauthenticated visitor is sent to the login page with the intended
 * destination preserved.
 */
export default function ProtectedRoute({ component: Component, children, ...rest }) {
  const { isAuthenticated, loading } = useAuth();

  return (
    <Route
      {...rest}
      render={(props) => {
        if (loading) return <AuthGate />;
        if (!isAuthenticated) {
          return <Redirect to={{ pathname: '/login', state: { from: props.location } }} />;
        }
        if (Component) return <Component {...props} />;
        return children;
      }}
    />
  );
}
