import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Icons';
import useDocumentTitle from '../hooks/useDocumentTitle';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <Logo className="h-10 w-10" />
      <p className="mono mt-6 text-ink-500">404</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-tightest text-ink-900">
        That page does not exist
      </h1>
      <p className="mt-2 max-w-sm text-[14px] text-ink-500">
        Check the address, or head back to the detection overview.
      </p>
      <div className="mt-6 flex gap-3">
        <Link to="/" className="btn-outline">
          Back to site
        </Link>
        <Link to="/app" className="btn-primary">
          Open dashboard
        </Link>
      </div>
    </div>
  );
}
