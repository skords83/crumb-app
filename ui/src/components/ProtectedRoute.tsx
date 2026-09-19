'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

const publicPaths = ['/login', '/forgot-password', '/reset-password'];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, verificationError, retryVerification } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !verificationError && !user && !publicPaths.some(p => pathname.startsWith(p))) {
      router.push('/login');
    }
  }, [user, isLoading, verificationError, router, pathname]);

  if (verificationError && !publicPaths.includes(pathname)) {
    return <div className="min-h-[100dvh] flex items-center justify-center px-6">
      <div className="text-center max-w-sm" role="alert">
        <p>{verificationError}</p>
        <button onClick={retryVerification} className="mt-4 rounded-xl bg-[#8B7355] px-5 py-3 text-white">Erneut versuchen</button>
      </div>
    </div>;
  }

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#F4F7F8] dark:bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-[#8B7355] mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">Laden...</p>
        </div>
      </div>
    );
  }

  if (!user && !publicPaths.some(p => pathname.startsWith(p))) {
    return null;
  }

  return <>{children}</>;
}
