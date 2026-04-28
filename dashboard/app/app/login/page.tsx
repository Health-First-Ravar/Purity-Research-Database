import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-2 text-center font-serif text-2xl">Purity Lab</h1>
      <p className="mb-6 text-center text-sm text-purity-muted dark:text-purity-mist">
        Sign in to continue
      </p>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
