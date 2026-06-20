import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import AppLayout from '../../components/layout/AppLayout';
import { generateStory } from '../../services/stories';

const PROGRESS_STEPS = [
  'Connecting to AI...',
  'Generating your story arc...',
  'Saving to database...',
  'Done! Redirecting...',
];

export default function Home() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [userCharacter, setUserCharacter] = useState('');
  const [title, setTitle] = useState('');
  const [autoTitle, setAutoTitle] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError('');
    setProgressStep(0);

    try {
      // Step 1: Connecting
      setProgressStep(0);
      await new Promise((r) => setTimeout(r, 500));

      // Step 2: Generating
      setProgressStep(1);
      const result = await generateStory({
        prompt: prompt.trim(),
        userCharacter: userCharacter.trim(),
        title: autoTitle ? '' : title.trim(),
      });

      // Step 3: Saved
      setProgressStep(2);
      await new Promise((r) => setTimeout(r, 500));

      // Step 4: Done
      setProgressStep(3);
      await new Promise((r) => setTimeout(r, 800));

      navigate(`/story-detail/${result.story._id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate story. Please try again.');
      setLoading(false);
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
              disabled={loading}
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
              disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
                className="w-full px-6 py-4 bg-dark-card border border-dark-border rounded-2xl text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary text-lg tracking-widest"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          {/* Generate Button / Progress */}
          {loading ? (
            <div className="bg-dark-card border border-dark-border rounded-2xl p-6">
              <div className="space-y-3">
                {PROGRESS_STEPS.map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {i < progressStep ? (
                      <svg className="w-5 h-5 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : i === progressStep ? (
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    ) : (
                      <div className="w-5 h-5 border-2 border-dark-border rounded-full flex-shrink-0" />
                    )}
                    <span className={i <= progressStep ? 'text-text-primary' : 'text-text-secondary/50'}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
              {/* Progress bar */}
              <div className="mt-4 h-1.5 bg-dark-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${((progressStep + 1) / PROGRESS_STEPS.length) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="w-full py-4 bg-primary hover:bg-primary/80 text-white text-lg font-semibold rounded-2xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate Story
            </button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
