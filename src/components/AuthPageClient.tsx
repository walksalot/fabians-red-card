'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthForm, type AuthMode } from './AuthForm';
import { safePath } from './client-api';

/** Client half of /login and /register: runs AuthForm then navigates to ?next= (or /). */
export function AuthPageClient({
  mode,
  next,
}: {
  mode: AuthMode;
  next?: string;
}) {
  const router = useRouter();
  const dest = safePath(next);
  const otherPath = mode === 'login' ? '/register' : '/login';
  const otherHref = next
    ? `${otherPath}?next=${encodeURIComponent(next)}`
    : otherPath;

  return (
    <div className="space-y-6">
      <AuthForm
        mode={mode}
        onSuccess={() => {
          router.push(dest);
          router.refresh();
        }}
      />
      <p className="text-center text-sm text-zinc-400">
        {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
        <Link
          href={otherHref}
          className="font-semibold text-emerald-400 hover:underline"
        >
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}

export default AuthPageClient;
