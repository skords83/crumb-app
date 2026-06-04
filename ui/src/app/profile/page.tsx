'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// /profile → /settings?tab=security
export default function ProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=security');
  }, [router]);
  return null;
}