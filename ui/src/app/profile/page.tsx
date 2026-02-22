'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, CheckCircle, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ProfilePage() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('Die neuen Passwörter stimmen nicht überein');
      return;
    }

    if (newPassword.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen haben');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`
        },
        body: JSON.stringify({ 
          currentPassword, 
          newPassword 
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Fehler beim Ändern des Passworts');
        return;
      }

      setMessage('Passwort wurde erfolgreich geändert');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError('Verbindungsfehler. Bitte versuche es später erneut.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7F8] dark:bg-[#0F172A] p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-[#8B7355] dark:hover:text-[#8B7355] mb-6 font-medium text-sm transition-colors"
        >
          <ArrowLeft size={18} /> Zurück zur Bibliothek
        </button>

        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 bg-[#8B7355] rounded-2xl flex items-center justify-center">
              <KeyRound size={32} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
                Passwort ändern
              </h1>
              <p className="text-gray-500 dark:text-gray-400">
                Ändere dein Passwort hier
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl text-green-600 dark:text-green-300 text-sm flex items-center gap-2">
              <CheckCircle size={18} />
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                Aktuelles Passwort
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                Neues Passwort
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors"
                placeholder="••••••••"
                required
                minLength={6}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Mindestens 6 Zeichen
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                Neues Passwort bestätigen
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors"
                placeholder="••••••••"
                required
                minLength={6}
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
                  Passwort ändern...
                </>
              ) : (
                'Passwort ändern'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
