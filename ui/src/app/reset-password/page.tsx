'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ArrowLeft, CheckCircle } from 'lucide-react';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get('token');
  const userId = searchParams.get('uid');

  useEffect(() => {
    if (!token || !userId) {
      setError('Ungültiger Link. BitteFordere einen neuen Link an.');
    }
  }, [token, userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (password !== confirmPassword) {
      setError('Die Passwörter stimmen nicht überein');
      return;
    }

    if (password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen haben');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, userId, newPassword: password })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Fehler beim Zurücksetzen des Passworts');
        return;
      }

      setIsSuccess(true);
      setMessage('Passwort wurde erfolgreich zurückgesetzt.');
      
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err) {
      setError('Verbindungsfehler. Bitte versuche es später erneut.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-[100dvh] bg-[#F4F7F8] dark:bg-[#0F172A] flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-gray-700 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            Passwort zurückgesetzt!
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Dein Passwort wurde erfolgreich geändert. Du wirst jetzt zur Anmeldung weitergeleitet...
          </p>
          <button
            onClick={() => router.push('/login')}
            className="text-[#8B7355] hover:text-[#766248] font-medium"
          >
            Zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8] dark:bg-[#0F172A] flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
        <button
          onClick={() => router.push('/login')}
          className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-[#8B7355] mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Zurück zur Anmeldung
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#8B7355] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-black text-white">C</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            Neues Passwort
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            Gib ein neues Passwort für dein Konto ein.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl text-green-600 dark:text-green-300 text-sm">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
              Neues Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors"
              placeholder="••••••••"
              required
              minLength={6}
              disabled={!token || !userId}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
              Passwort bestätigen
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors"
              placeholder="••••••••"
              required
              minLength={6}
              disabled={!token || !userId}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !token || !userId}
            className="w-full py-3 px-4 bg-[#8B7355] hover:bg-[#766248] text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Passwort zurücksetzen...
              </>
            ) : (
              'Passwort zurücksetzen'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[#8B7355]" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
