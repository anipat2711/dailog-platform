import { create } from 'zustand';

function loadAuthFromStorage() {
  try {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user'));
    if (token && user) {
      return { user, isAuthenticated: true };
    }
  } catch {}
  return { user: null, isAuthenticated: false };
}

const useAuthStore = create((set) => ({
  ...loadAuthFromStorage(),
  login: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, isAuthenticated: false });
  },
}));

export default useAuthStore;
