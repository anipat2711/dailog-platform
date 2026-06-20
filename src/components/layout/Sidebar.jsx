import { NavLink, useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

export default function Sidebar() {
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="w-64 h-screen bg-dark-card border-r border-dark-border flex flex-col fixed left-0 top-0">
      <div className="p-6 border-b border-dark-border">
        <h2 className="text-lg font-bold text-text-primary">Companion Labs</h2>
        <p className="text-xs text-text-secondary mt-1">Dailog Platform</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-dark-bg'
            }`
          }
        >
          Home
        </NavLink>
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-dark-bg'
            }`
          }
        >
          Dashboard
        </NavLink>
      </nav>

      <div className="p-4 border-t border-dark-border">
        <div className="flex items-center gap-3 px-4 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">
            {user?.name?.charAt(0)}
          </div>
          <span className="text-sm text-text-primary truncate">{user?.name}</span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full px-4 py-2 text-sm text-text-secondary hover:text-red-400 hover:bg-dark-bg rounded-lg transition-colors text-left"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
