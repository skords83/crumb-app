'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Diese Seite leitet auf die neue Einstellungsseite weiter.
// /profile/notifications → /settings?tab=notifications
export default function NotificationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=notifications');
  }, [router]);
  return null;
}