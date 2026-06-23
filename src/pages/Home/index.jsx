import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import AppLayout from '../../components/layout/AppLayout';

const DEMO_MODE = true;

export default function Home() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [userCharacter, setUserCharacter] = useState('');
  const [title, setTitle] = useState('');
  const [autoTitle, setAutoTitle] = useState(true);
  const [showDemoModal, setShowDemoModal] = useState(false);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    if (DEMO_MODE) {
      setShowDemoModal(true);
      return;
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center min-h-screen px-8">
        <div className="text-center mb-12">
          <p className="text-sm font-medium text-primary tracking-widest uppercase mb-3">
            Companion Labs
          </p>
          <h1 className="text-4xl font-bold text-text-primary mb-3">
            Welcome, {user?.name}
          </h1>
          <p className="text-text-secondary text-lg">
            What story would you like to create today?
          </p>
        </div>

        <div className="w-full max-w-2xl space-y-4">
          {/* Story Prompt */}
          <div>
            <label className="block text-text-secondary text-sm mb-2">Story Concept</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your story arc... e.g. A small-town girl who becomes a spy in Pakistan"
              rows={3}
              disabled={false}
              className="w-full px-6 py-4 bg-dark-card border border-dark-border rounded-2xl text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary text-lg resize-none"
            />
          </div>

          {/* User Character */}
          <div>
            <label className="block text-text-secondary text-sm mb-2">Your Character Role</label>
            <input
              type="text"
              value={userCharacter}
              onChange={(e) => setUserCharacter(e.target.value)}
              placeholder="e.g. male spy, female journalist, undercover cop..."
              disabled={false}
              className="w-full px-6 py-4 bg-dark-card border border-dark-border rounded-2xl text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary text-lg"
            />
          </div>

          {/* Title Toggle */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoTitle}
                onChange={(e) => setAutoTitle(e.target.checked)}
                disabled={false}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-text-secondary text-sm">Generate title automatically</span>
            </label>
          </div>

          {/* Title Input (conditional) */}
          {!autoTitle && (
            <div>
              <label className="block text-text-secondary text-sm mb-2">Story Title (2 words, CAPS)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.toUpperCase())}
                placeholder="e.g. KARACHI COVER"
                disabled={false}
                className="w-full px-6 py-4 bg-dark-card border border-dark-border rounded-2xl text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary text-lg tracking-widest"
              />
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="w-full py-4 bg-primary hover:bg-primary/80 text-white text-lg font-semibold rounded-2xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generate Story
          </button>
        </div>

        {/* Demo Mode Modal */}
        {showDemoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDemoModal(false)}>
            <div className="bg-dark-card border border-primary/30 rounded-2xl p-8 max-w-md mx-4 shadow-2xl shadow-primary/10" onClick={(e) => e.stopPropagation()}>
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-text-primary mb-3">Demo Mode</h3>
              <p className="text-text-secondary leading-relaxed mb-6">
                Story generation is currently disabled for this demo. Please explore the existing stories from the Dashboard to see the platform's capabilities.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate('/dashboard')}
                  className="flex-1 py-3 bg-primary hover:bg-primary/80 text-white font-semibold rounded-xl transition-colors"
                >
                  Go to Dashboard
                </button>
                <button
                  onClick={() => setShowDemoModal(false)}
                  className="px-5 py-3 bg-dark-border text-text-secondary hover:text-text-primary rounded-xl transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
