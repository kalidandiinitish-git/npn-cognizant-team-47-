import React from 'react';
import { Route, Switch } from 'react-router-dom';
import AppShell from '../components/app/AppShell';
import { StreamProvider } from '../context/StreamContext';
import Accounts from '../pages/Accounts';
import Alerts from '../pages/Alerts';
import Analytics from '../pages/Analytics';
import Dashboard from '../pages/Dashboard';
import Dataset from '../pages/Dataset';
import Investigations from '../pages/Investigations';
import Monitor from '../pages/Monitor';
import NotFound from '../pages/NotFound';

/**
 * The authenticated console. Loaded lazily so visitors to the public landing
 * page do not download the charting and dashboard code.
 *
 * StreamProvider sits here so polling and Realtime subscriptions only run for
 * signed-in users, and survive navigation between console pages.
 */
export default function Console() {
  return (
    <StreamProvider>
      <AppShell>
        <Switch>
          <Route exact path="/app" component={Dashboard} />
          <Route path="/app/monitor" component={Monitor} />
          <Route path="/app/alerts" component={Alerts} />
          <Route path="/app/investigations" component={Investigations} />
          <Route path="/app/accounts" component={Accounts} />
          <Route path="/app/analytics" component={Analytics} />
          <Route path="/app/dataset" component={Dataset} />
          <Route component={NotFound} />
        </Switch>
      </AppShell>
    </StreamProvider>
  );
}
