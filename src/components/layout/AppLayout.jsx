import Sidebar from './Sidebar';

export default function AppLayout({ children }) {
  return (
    <div className="min-h-screen bg-dark-bg">
      <Sidebar />
      <main className="ml-64">{children}</main>
    </div>
  );
}
