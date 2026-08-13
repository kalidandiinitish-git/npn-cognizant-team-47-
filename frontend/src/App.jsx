import React, { Suspense, lazy } from 'react';
import { Route, Switch } from 'react-router-dom';
import { Logo } from './components/Icons';
import { Spinner } from './components/ui';
import ProtectedRoute from './routes/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import NotFound from './pages/NotFound';

// The console carries the charts and live tables. Splitting it keeps the public
// landing page light. React.lazy is available in React 16.6+.
const Console = lazy(() => import('./console/Console'));

function ConsoleLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
      <Logo className="h-9 w-9" />
      <span className="flex items-center gap-2 text-[13.5px] text-ink-500">
        <Spinner className="h-4 w-4" />
        Loading the console
      </span>
    </div>
  );
}

export default function App() {
  return (
    <Switch>
      <Route exact path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <ProtectedRoute path="/app">
        <Suspense fallback={<ConsoleLoading />}>
          <Console />
        </Suspense>
      </ProtectedRoute>
      <Route component={NotFound} />
    </Switch>
  );
}
