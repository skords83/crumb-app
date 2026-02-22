'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/request-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Fehler bei der Anfrage');
        return;
      }

      setMessage('Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen des Passworts gesendet.');
    } catch (err) {
      setError('Verbindungsfehler. Bitte versuche es später erneut.');
    } finally {
      setIsLoading(false);
    }
  };

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
            Passwort vergessen?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            Gib deine E-Mail-Adresse ein, um einen Link zum Zurücksetzen zu erhalten.
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
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors"
              placeholder="deine@email.de"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 bg-[#8B7355] hover:bg-[#766248] text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Link senden...
              </>
            ) : (
              'Link senden'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
