import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '../../components/layout/AppLayout';
import { getAllStories, deleteStory } from '../../services/stories';
import useGenerationStore from '../../store/generationStore';
import useAuthStore from '../../store/authStore';

const statusMap = {
  draft: { label: 'Draft', colors: 'bg-gray-500/20 text-gray-400' },
  'in-progress': { label: 'In Progress', colors: 'bg-amber-500/20 text-amber-400' },
  complete: { label: 'Complete', colors: 'bg-emerald-500/20 text-emerald-400' },
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

function imgUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${API_BASE}${path}`;
}

function StoryCard({ story, isCreator, onDelete }) {
  const navigate = useNavigate();
  const genStatus = useGenerationStore((s) => s.getStatus(story._id));
  const isGenerating = genStatus?.status === 'running';
  const status = statusMap[story.status] || statusMap.draft;
  const pct = genStatus?.total > 0 ? Math.round((genStatus.completed / genStatus.total) * 100) : 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      onClick={() => navigate(`/story-detail/${story._id}`)}
      className="bg-dark-card border border-dark-border rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:border-primary hover:shadow-[0_0_20px_rgba(124,58,237,0.15)] relative"
    >
      <div className="aspect-video w-full overflow-hidden bg-dark-border relative">
        {story.mainImage ? (
          <img
            src={imgUrl(story.mainImage)}
            alt={story.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl font-bold text-text-secondary/20 tracking-widest">
              {story.title}
            </span>
          </div>
        )}
        {isGenerating && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
            <span className="text-white text-xs font-medium">Generating... {pct}%</span>
            <div className="w-3/4 h-1.5 bg-dark-border rounded-full overflow-hidden">
              <div className="h-full bg-secondary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between">
          <h3 className="text-text-primary font-bold text-lg tracking-wide mb-2">
            {story.title}
          </h3>
          {isCreator && (
            <div ref={menuRef} className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                className="p-1.5 text-text-secondary hover:text-text-primary transition-colors rounded-lg hover:bg-dark-border/50"
                title="More options"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-20 bg-dark-card border border-dark-border rounded-lg shadow-xl py-1 min-w-[140px]">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); navigate(`/story-detail/${story._id}`); }}
                    className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-dark-border/50 transition-colors"
                  >
                    Open
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(story); }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {isGenerating ? (
          <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-secondary/20 text-secondary animate-pulse">
            Generating Images...
          </span>
        ) : (
          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${status.colors}`}>
            {status.label}
          </span>
        )}
        <div className="flex items-center justify-between mt-4 text-xs text-text-secondary">
          <span>{story.creatorName}</span>
          <span>{new Date(story.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState(null); // story object or null
  const [deleting, setDeleting] = useState(false);

  // Check if any generation is running — if so, poll faster
  const activeGens = useGenerationStore((s) => s.activeGenerations);
  const hasActiveGen = Object.values(activeGens).some((g) => g.status === 'running');

  const { data: stories = [], isLoading, error } = useQuery({
    queryKey: ['stories'],
    queryFn: getAllStories,
    // Only poll when generation is active (5s), otherwise no auto-poll
    refetchInterval: hasActiveGen ? 5000 : false,
    // Never poll when tab is hidden
    refetchIntervalInBackground: false,
  });

  const filtered = stories.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteStory(deleteTarget._id);
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      setDeleteTarget(null);
    } catch {
      // keep modal open on error
    }
    setDeleting(false);
  };

  return (
    <AppLayout>
      <div className="p-8">
        {/* Search bar */}
        <div className="mb-8">
          <input
            type="text"
            placeholder="Search stories by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md px-4 py-3 bg-dark-card border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary"
          />
        </div>

        {/* Page title */}
        <h1 className="text-3xl font-bold text-text-primary mb-6">All Stories</h1>

        {/* Loading state */}
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-red-500">Failed to load stories</p>
          </div>
        ) : stories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <p className="text-text-secondary text-lg mb-6">
              No stories yet. Create your first story!
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-primary hover:bg-primary/80 text-white font-semibold rounded-lg transition-colors"
            >
              Create Story
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-text-secondary text-lg">No stories found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((story) => (
              <StoryCard
                key={story._id}
                story={story}
                isCreator={user?.id === story.creatorId}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={deleting ? undefined : () => setDeleteTarget(null)} />
          <div className="relative bg-dark-card border border-dark-border rounded-2xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-bold text-text-primary mb-3">Delete Story?</h3>
            <p className="text-text-secondary text-sm mb-2">
              <span className="text-text-primary font-semibold">{deleteTarget.title}</span>
            </p>
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-5">
              <p className="text-red-400 text-sm leading-relaxed">
                This will permanently delete this story, all episodes, all characters, and all generated images. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete Permanently'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
