import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import { loginUser, registerUser } from '../../services/auth';

const ALLOWED_DOMAIN = '@cmpntech.com';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.endsWith(ALLOWED_DOMAIN)) {
      setError('Only @cmpntech.com emails are allowed');
      return;
    }

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const data = isRegister
        ? await registerUser({ email, password })
        : await loginUser({ email, password });

      login(data.user, data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="bg-dark-card border border-dark-border rounded-2xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-text-primary mb-2">
          {isRegister ? 'Create account' : 'Welcome back'}
        </h1>
        <p className="text-text-secondary mb-8">
          {isRegister ? 'Register with your @cmpntech.com email' : 'Log in to your account'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder="you@cmpntech.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-slate-400 mt-1">Demo: anirvan@cmpntech.com</p>
          </div>
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-slate-400 mt-1">Demo: test123</p>
          </div>
          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary hover:bg-primary/80 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isRegister ? 'Register' : 'Log In'}
          </button>
        </form>
        <p className="text-text-secondary text-sm text-center mt-6">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            className="text-primary hover:underline"
          >
            {isRegister ? 'Log In' : 'Register'}
          </button>
        </p>
      </div>
    </div>
  );
}
