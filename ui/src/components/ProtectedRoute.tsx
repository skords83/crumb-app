'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

const publicPaths = ['/login', '/forgot-password', '/reset-password'];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !user && !publicPaths.some(p => pathname.startsWith(p))) {
      router.push('/login');
    }
  }, [user, isLoading, router, pathname]);

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
