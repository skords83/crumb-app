'use client';
import { usePathname } from 'next/navigation';

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = ['/login', '/register', '/forgot-password', '/reset-password'].includes(pathname);

  return (
    <main className={isAuthPage ? '' : 'pt-28 md:pt-36 pb-24 md:pb-8'}>
      {children}
    </main>
  );
}