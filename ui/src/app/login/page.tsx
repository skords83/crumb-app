'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const { login, register, isLoading, error } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isRegister) {
        await register(email, password);
      } else {
        await login(email, password);
      }
      router.push('/');
    } catch (err) {
      // Error is handled by auth context
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0F172A] flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full bg-gray-800/80 backdrop-blur-sm rounded-3xl shadow-xl p-8 border border-gray-700">
        <div className="text-center mb-8">
          <div className="w-16 h-16 border-2 border-white/30 rounded-full flex items-center justify-center bg-white/10 overflow-hidden mx-auto mb-4">
            <img src="/logo.png" alt="Crumb Logo" className="w-11 h-11 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100">
            {isRegister ? 'Konto erstellen' : 'Willkommen zurück'}
          </h1>
          <p className="text-gray-400 mt-2">
            {isRegister ? 'Erstelle ein neues Konto' : 'Melde dich an um fortzufahren'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-700 bg-gray-900 text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors placeholder:text-gray-600"
              placeholder="deine@email.de"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-700 bg-gray-900 text-gray-100 focus:border-[#8B7355] focus:outline-none transition-colors placeholder:text-gray-600"
              placeholder="••••••••"
              required
              minLength={6}
            />
            {isRegister && (
              <p className="text-xs text-gray-500 mt-1">
                Mindestens 6 Zeichen
              </p>
            )}
            {!isRegister && (
              <div className="mt-2 text-right">
                <a href="/forgot-password" className="text-sm text-[#8B7355] hover:text-[#9d8466] font-medium transition-colors underline-offset-2 hover:underline">
                  Passwort vergessen?
                </a>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 bg-[#8B7355] hover:bg-[#766248] text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                {isRegister ? 'Konto wird erstellt...' : 'Anmeldung...'}
              </>
            ) : (
              isRegister ? 'Konto erstellen' : 'Anmelden'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-sm text-[#8B7355] hover:text-[#9d8466] font-medium transition-colors"
          >
            {isRegister 
              ? 'Bereits ein Konto? Anmelden' 
              : 'Noch kein Konto? Registrieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
