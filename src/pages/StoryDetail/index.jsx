import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '../../components/layout/AppLayout';
import {
  getStoryById,
  generateMainImage,
  updateEpisode,
  regenerateStory,
  regenerateCharacterImage,
  regenerateHeroImage,
  regenerateSceneImage,
  updateStoryTitle,
  markStoryComplete,
  deleteStory,
  updateCharacterName,
  updateHeroName,
} from '../../services/stories';
import useAuthStore from '../../store/authStore';
import useEditStore from '../../store/editStore';
import useGenerationStore from '../../store/generationStore';

const DEMO_MODE = true;
const DEMO_MSG = 'Image generation is disabled for this demo.';

const statusMap = {
  draft: { label: 'Draft', colors: 'bg-gray-500/20 text-gray-400' },
  'in-progress': { label: 'In Progress', colors: 'bg-amber-500/20 text-amber-400' },
  complete: { label: 'Complete', colors: 'bg-emerald-500/20 text-emerald-400' },
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://dailog-platform-api.onrender.com';

function imgUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${API_BASE}${path}`;
}

// ─── Toast Component (Fix 5: dismissable error toasts) ───
function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  const bg = toast.type === 'success' ? 'bg-emerald-500/90' : 'bg-red-500/90';
  return (
    <div className={`fixed top-6 right-6 z-50 ${bg} text-white px-5 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-3`}>
      <span>{toast.message}</span>
      {toast.persistent && (
        <button onClick={onDismiss} className="ml-2 text-white/70 hover:text-white text-lg leading-none">&times;</button>
      )}
    </div>
  );
}

// ─── Modal Wrapper ───
function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-card border border-dark-border rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// ─── Icons ───
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function Spinner({ size = 'w-4 h-4' }) {
  return <div className={`${size} border-2 border-white border-t-transparent rounded-full animate-spin`} />;
}

// ─── Scene Regen Progress Card (Fix 3) ───
function SceneRegenProgress({ progress, characterName }) {
  if (!progress) return null;
  const { total, completed, log } = progress;
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const isDone = completed >= total;

  return (
    <div className="mt-4 p-4 bg-dark-bg border border-dark-border rounded-lg">
      <p className="text-text-primary text-sm font-medium mb-2">
        {isDone
          ? `Complete! ${completed} scene${completed !== 1 ? 's' : ''} updated.`
          : `Updating scenes with ${characterName}'s new image...`}
      </p>
      {/* Progress bar */}
      <div className="h-2 bg-dark-border rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Per-scene log */}
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {log.map((entry) => (
          <div key={entry.ep} className="flex items-center gap-2 text-xs">
            {entry.status === 'done' && <span className="text-emerald-400">&#10003;</span>}
            {entry.status === 'failed' && <span className="text-red-400">&#10007;</span>}
            {entry.status === 'generating' && <Spinner size="w-3 h-3" />}
            <span className={entry.status === 'failed' ? 'text-red-400' : 'text-text-secondary'}>
              Scene {entry.ep}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StoryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // Edit store
  const {
    editingEpisode, editFields, savingEpisode, saveStatus,
    characterModal, sceneImageModal, coverImageModal, regenStoryModal,
    regeneratingCharImage, regeneratingSceneImage, regeneratingCover, regeneratingStory,
    sceneRegenProgress,
    toast,
    startEditEpisode, updateEditField, cancelEditEpisode,
    setSavingEpisode, setSaveStatus,
    openCharacterModal, closeCharacterModal,
    openSceneImageModal, closeSceneImageModal,
    openCoverImageModal, closeCoverImageModal,
    openRegenStoryModal, closeRegenStoryModal,
    setRegeneratingCharImage, setRegeneratingSceneImage, setRegeneratingCover, setRegeneratingStory,
    initSceneRegenProgress, updateSceneRegenProgress, clearSceneRegenProgress,
    showToast, dismissToast,
  } = useEditStore();

  // Global generation store (survives navigation)
  const genStatus = useGenerationStore((s) => s.getStatus(id));
  const startGeneration = useGenerationStore((s) => s.startGeneration);
  const checkAndResume = useGenerationStore((s) => s.checkAndResume);
  const clearGeneration = useGenerationStore((s) => s.clearGeneration);

  // Derived generation state
  const generating = genStatus?.status === 'running';
  const genDone = genStatus?.status === 'complete' || genStatus?.status === 'failed';
  const genPhase = genStatus?.phase || '';
  const genCurrent = genStatus?.current || '';
  const genCompleted = genStatus?.completed || 0;
  const genTotal = genStatus?.total || 0;
  const genFailed = genStatus?.failed || [];
  const genError = genStatus?.error || '';

  // Modal prompts
  const [mainPrompt, setMainPrompt] = useState('');
  const [generatingMain, setGeneratingMain] = useState(false);
  const [charPrompt, setCharPrompt] = useState('');
  const [scenePrompt, setScenePrompt] = useState('');
  const [coverPrompt, setCoverPrompt] = useState('');

  // Title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [titleError, setTitleError] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  // Complete button state
  const [completingStory, setCompletingStory] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingStory, setDeletingStory] = useState(false);

  // Character name edit state
  const [editingCharName, setEditingCharName] = useState(null); // characterId or 'hero'
  const [charNameInput, setCharNameInput] = useState('');
  const [charNameError, setCharNameError] = useState('');
  const [savingCharName, setSavingCharName] = useState(false);

  // Auto-save debounce ref
  const autoSaveTimer = useRef(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['story', id],
    queryFn: () => getStoryById(id),
    // Refetch every 10s while generation is running to show new images
    refetchInterval: generating ? 10000 : false,
  });

  // Set browser tab title
  useEffect(() => {
    if (data?.story?.title) {
      document.title = data.story.title + ' — Dailog';
    }
    return () => { document.title = 'Dailog'; };
  }, [data?.story?.title]);

  // Check for active generation on mount (resume if navigated away and back)
  useEffect(() => {
    if (id) checkAndResume(id);
  }, [id, checkAndResume]);

  // Refetch story data when generation completes
  const prevGenStatus = useRef(null);
  useEffect(() => {
    if (prevGenStatus.current === 'running' && (genStatus?.status === 'complete' || genStatus?.status === 'failed')) {
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    }
    prevGenStatus.current = genStatus?.status || null;
  }, [genStatus?.status, id, queryClient]);

  // Auto-save effect for episode editing
  useEffect(() => {
    if (editingEpisode === null) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);

    setSaveStatus('saving');
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await updateEpisode(id, editingEpisode, {
          sceneDetails: editFields.sceneDetails,
          productionNotes: editFields.productionNotes,
        });
        setSaveStatus('saved');
        queryClient.invalidateQueries({ queryKey: ['story', id] });
      } catch {
        setSaveStatus('error');
      }
    }, 2000);

    return () => clearTimeout(autoSaveTimer.current);
  }, [editFields.sceneDetails, editFields.productionNotes]);

  const handleGenerateImages = useCallback(async () => {
    if (DEMO_MODE) { showToast(DEMO_MSG, 'error'); return; }
    await startGeneration(id);
  }, [id, startGeneration]);

  const handleGenerateMainImage = async () => {
    if (!mainPrompt.trim()) return;
    if (DEMO_MODE) { showToast(DEMO_MSG, 'error'); return; }
    setGeneratingMain(true);
    try {
      await generateMainImage(id, mainPrompt.trim());
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      setMainPrompt('');
      showToast('Cover image generated!');
    } catch {
      showToast('Failed to generate cover image', 'error');
    }
    setGeneratingMain(false);
  };

  // Save & Regenerate episode scene
  const handleSaveEpisode = async () => {
    if (editingEpisode === null) return;
    if (DEMO_MODE) { showToast('Episode editing is disabled for this demo.', 'error'); return; }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSavingEpisode(true);
    setSaveStatus('saving');
    try {
      await updateEpisode(id, editingEpisode, {
        sceneDetails: editFields.sceneDetails,
        productionNotes: editFields.productionNotes,
      });
      setSaveStatus('saved');
      cancelEditEpisode();
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      showToast('Episode saved & scene image regenerated!');
    } catch {
      setSaveStatus('error');
      showToast('Failed to save episode', 'error');
    }
    setSavingEpisode(false);
  };

  // Fix 2: Regenerate full story — uses confirmation modal now
  const handleConfirmRegenerateStory = async () => {
    closeRegenStoryModal();
    if (DEMO_MODE) { showToast('Story regeneration is disabled for this demo.', 'error'); return; }
    setRegeneratingStory(true);
    try {
      await regenerateStory(id);
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      showToast('Story regenerated! Generate images to complete.');
    } catch {
      showToast('Failed to regenerate story', 'error');
    }
    setRegeneratingStory(false);
  };

  // SSE handler for character/hero image regeneration (Fix 1 + Fix 3)
  const handleSSECharImageRegen = (event) => {
    switch (event.type) {
      case 'phase':
        if (event.phase === 'scenes') {
          initSceneRegenProgress(event.total);
        }
        break;
      case 'character_image_done':
        // Character portrait is done, scenes start next
        break;
      case 'scene_progress':
        updateSceneRegenProgress(event.episodeNumber, event.current, event.total, event.status);
        break;
      case 'done':
      case 'error':
        // handled after promise resolves
        break;
    }
  };

  // Regenerate character image (Fix 3: SSE with progress)
  const handleRegenerateCharImage = async () => {
    if (!charPrompt.trim() || !characterModal) return;
    if (DEMO_MODE) { showToast(DEMO_MSG, 'error'); return; }
    setRegeneratingCharImage(true);
    clearSceneRegenProgress();
    try {
      const charName = characterModal.name;
      const isHero = characterModal.isHero;

      let result;
      if (isHero) {
        // Fix 1: Hero image edit via dedicated SSE endpoint
        result = await regenerateHeroImage(id, charPrompt.trim(), handleSSECharImageRegen);
      } else {
        result = await regenerateCharacterImage(id, characterModal.characterId, charPrompt.trim(), handleSSECharImageRegen);
      }

      queryClient.invalidateQueries({ queryKey: ['story', id] });

      if (result.type === 'error') {
        showToast(`Failed to regenerate ${charName}'s image`, 'error');
      } else {
        // Fix 5: Character name in toast
        const count = result.totalUpdated || 0;
        showToast(`${charName}'s image updated! ${count} scene${count !== 1 ? 's' : ''} regenerated.`);
      }

      // Don't close modal immediately so user can see final progress
      setTimeout(() => {
        closeCharacterModal();
        setCharPrompt('');
      }, 1500);
    } catch {
      showToast(`Failed to regenerate ${characterModal.name}'s image`, 'error');
    }
    setRegeneratingCharImage(false);
  };

  // Regenerate scene image
  const handleRegenerateSceneImage = async () => {
    if (!scenePrompt.trim() || !sceneImageModal) return;
    if (DEMO_MODE) { showToast(DEMO_MSG, 'error'); return; }
    setRegeneratingSceneImage(true);
    try {
      await regenerateSceneImage(id, sceneImageModal.episodeNumber, scenePrompt.trim());
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      closeSceneImageModal();
      setScenePrompt('');
      showToast('Scene image regenerated!');
    } catch {
      showToast('Failed to regenerate scene image', 'error');
    }
    setRegeneratingSceneImage(false);
  };

  // Regenerate cover from modal
  const handleRegenerateCover = async () => {
    if (!coverPrompt.trim()) return;
    if (DEMO_MODE) { showToast(DEMO_MSG, 'error'); return; }
    setRegeneratingCover(true);
    try {
      await generateMainImage(id, coverPrompt.trim());
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      closeCoverImageModal();
      setCoverPrompt('');
      showToast('Cover image regenerated!');
    } catch {
      showToast('Failed to regenerate cover image', 'error');
    }
    setRegeneratingCover(false);
  };

  // Title edit handlers
  const handleStartEditTitle = () => {
    setEditingTitle(true);
    setTitleInput(data?.story?.title || '');
    setTitleError('');
  };

  const handleCancelEditTitle = () => {
    setEditingTitle(false);
    setTitleInput('');
    setTitleError('');
  };

  const handleSaveTitle = async () => {
    const words = titleInput.trim().split(/\s+/);
    if (words.length !== 2) {
      setTitleError('Title must be exactly 2 words in CAPS (e.g. VISA VOWS)');
      return;
    }
    setSavingTitle(true);
    setTitleError('');
    try {
      await updateStoryTitle(id, titleInput.trim());
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      document.title = titleInput.trim().toUpperCase() + ' — Dailog';
      setEditingTitle(false);
      setTitleInput('');
      showToast('Title updated!');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update title';
      setTitleError(msg);
    }
    setSavingTitle(false);
  };

  // Mark complete handler
  const handleMarkComplete = async () => {
    setShowCompleteConfirm(false);
    setCompletingStory(true);
    try {
      await markStoryComplete(id);
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      showToast('Story marked as complete!');
    } catch {
      showToast('Failed to mark story as complete', 'error');
    }
    setCompletingStory(false);
  };

  // Character name edit handlers
  const handleStartCharNameEdit = (char) => {
    setEditingCharName(char.isHero ? 'hero' : char._id);
    setCharNameInput(char.name);
    setCharNameError('');
  };

  const handleCancelCharNameEdit = () => {
    setEditingCharName(null);
    setCharNameInput('');
    setCharNameError('');
  };

  const handleSaveCharName = async (char) => {
    const trimmed = charNameInput.trim();
    if (!trimmed) { setCharNameError('Name cannot be empty'); return; }
    if (trimmed.length > 50) { setCharNameError('Name cannot exceed 50 characters'); return; }

    setSavingCharName(true);
    setCharNameError('');
    try {
      if (char.isHero) {
        await updateHeroName(id, trimmed);
      } else {
        await updateCharacterName(id, char._id, trimmed);
      }
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      setEditingCharName(null);
      setCharNameInput('');
      showToast('Character name updated!');
    } catch (err) {
      setCharNameError(err.response?.data?.error || 'Failed to update name');
    }
    setSavingCharName(false);
  };

  // Delete story handler
  const handleDeleteStory = async () => {
    setShowDeleteConfirm(false);
    setDeletingStory(true);
    try {
      await deleteStory(id);
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      showToast('Story deleted successfully');
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch {
      showToast('Failed to delete story', 'error');
      setDeletingStory(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error || !data?.story) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="text-text-secondary text-lg mb-4">Story not found</p>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-primary hover:bg-primary/80 text-white font-semibold rounded-lg transition-colors">
            Back to Dashboard
          </button>
        </div>
      </AppLayout>
    );
  }

  const { story, heroProfile, characters, episodes } = data;
  const status = statusMap[story.status] || statusMap.draft;
  const hasAnyImages = characters?.some((c) => c.image) || episodes?.some((e) => e.sceneImage);
  const isCreator = user?.id === story.creatorId;

  return (
    <AppLayout>
      {/* Fix 5: Toast with dismiss for errors */}
      <Toast toast={toast} onDismiss={dismissToast} />

      {/* Character / Hero Image Edit Modal (Fix 1: works for hero too) */}
      <Modal open={!!characterModal} onClose={regeneratingCharImage ? undefined : closeCharacterModal}>
        <h3 className="text-lg font-bold text-text-primary mb-2">
          {characterModal?.isHero ? 'Edit Hero Image' : 'Edit Character Image'}
        </h3>
        <p className="text-text-secondary text-sm mb-4">{characterModal?.name}</p>
        {characterModal?.image && (
          <img src={imgUrl(characterModal.image)} alt={characterModal.name} className="w-full aspect-[3/4] object-cover rounded-lg mb-4" />
        )}

        {/* Prompt input — hidden during regen */}
        {!regeneratingCharImage && (
          <>
            <textarea
              value={charPrompt}
              onChange={(e) => setCharPrompt(e.target.value)}
              placeholder="Describe how you want to change this character..."
              rows={3}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary resize-none mb-4"
            />
            <p className="text-text-secondary/60 text-xs mb-4">
              {characterModal?.isHero
                ? 'All episode scenes will be regenerated to match the new hero look.'
                : 'All scenes with this character will be regenerated to match the new look.'}
            </p>
          </>
        )}

        {/* Fix 3: Scene regen progress */}
        <SceneRegenProgress progress={sceneRegenProgress} characterName={characterModal?.name || ''} />

        {/* Buttons */}
        {!regeneratingCharImage && !sceneRegenProgress && (
          <div className="flex gap-3 mt-4">
            <button onClick={closeCharacterModal} className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleRegenerateCharImage}
              disabled={!charPrompt.trim()}
              className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/80 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {characterModal?.isHero ? 'Regenerate Hero Image' : 'Regenerate Character Image'}
            </button>
          </div>
        )}

        {/* Loading state before scene progress shows */}
        {regeneratingCharImage && !sceneRegenProgress && (
          <div className="flex items-center gap-3 mt-4">
            <Spinner />
            <span className="text-text-secondary text-sm">Generating new {characterModal?.isHero ? 'hero' : 'character'} image...</span>
          </div>
        )}
      </Modal>

      {/* Scene Image Edit Modal */}
      <Modal open={!!sceneImageModal} onClose={closeSceneImageModal}>
        <h3 className="text-lg font-bold text-text-primary mb-2">Edit Scene Image</h3>
        <p className="text-text-secondary text-sm mb-4">Episode {sceneImageModal?.episodeNumber}: {sceneImageModal?.title}</p>
        {sceneImageModal?.sceneImage && (
          <img src={imgUrl(sceneImageModal.sceneImage)} alt="Scene" className="w-full aspect-video object-cover rounded-lg mb-4" />
        )}
        <textarea
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          placeholder="Describe how you want to change this scene..."
          rows={3}
          className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary resize-none mb-4"
        />
        <p className="text-text-secondary/60 text-xs mb-4">Character appearance will stay consistent.</p>
        <div className="flex gap-3">
          <button onClick={closeSceneImageModal} className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleRegenerateSceneImage}
            disabled={!scenePrompt.trim() || regeneratingSceneImage}
            className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/80 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {regeneratingSceneImage ? <><Spinner /> Regenerating...</> : 'Regenerate Scene Image'}
          </button>
        </div>
      </Modal>

      {/* Cover Image Edit Modal */}
      <Modal open={coverImageModal} onClose={closeCoverImageModal}>
        <h3 className="text-lg font-bold text-text-primary mb-2">Edit Cover Image</h3>
        <p className="text-text-secondary text-sm mb-4">Mention character names for consistency.</p>
        {story.mainImage && (
          <img src={imgUrl(story.mainImage)} alt="Cover" className="w-full aspect-video object-cover rounded-lg mb-4" />
        )}
        <textarea
          value={coverPrompt}
          onChange={(e) => setCoverPrompt(e.target.value)}
          placeholder="e.g. Arjun and Kavya at sunset, golden hour"
          rows={3}
          className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary resize-none mb-4"
        />
        <div className="flex gap-3">
          <button onClick={closeCoverImageModal} className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleRegenerateCover}
            disabled={!coverPrompt.trim() || regeneratingCover}
            className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/80 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {regeneratingCover ? <><Spinner /> Regenerating...</> : 'Regenerate Cover Image'}
          </button>
        </div>
      </Modal>

      {/* Fix 2: Regenerate Story Confirmation Modal */}
      <Modal open={regenStoryModal} onClose={closeRegenStoryModal}>
        <h3 className="text-lg font-bold text-text-primary mb-3">Regenerate Full Story?</h3>
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-5">
          <p className="text-red-400 text-sm leading-relaxed">
            This will delete ALL generated images and reset the story to Draft status.
            You will need to regenerate all images again. This cannot be undone.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={closeRegenStoryModal} className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirmRegenerateStory}
            className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors"
          >
            Yes, Regenerate
          </button>
        </div>
      </Modal>

      {/* Mark Complete Confirmation Modal */}
      <Modal open={showCompleteConfirm} onClose={() => setShowCompleteConfirm(false)}>
        <h3 className="text-lg font-bold text-text-primary mb-3">Mark as Complete?</h3>
        <p className="text-text-secondary text-sm mb-5 leading-relaxed">
          Mark this story as complete? You can still edit it after.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setShowCompleteConfirm(false)} className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleMarkComplete}
            className="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg transition-colors"
          >
            Yes, Mark Complete
          </button>
        </div>
      </Modal>

      {/* Delete Story Confirmation Modal */}
      <Modal open={showDeleteConfirm} onClose={deletingStory ? undefined : () => setShowDeleteConfirm(false)}>
        <h3 className="text-lg font-bold text-text-primary mb-3">Delete Story?</h3>
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-5">
          <p className="text-red-400 text-sm leading-relaxed">
            This will permanently delete this story, all episodes, all characters, and all generated images. This cannot be undone.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 px-4 py-2.5 bg-dark-border text-text-secondary rounded-lg hover:bg-dark-border/80 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleDeleteStory}
            disabled={deletingStory}
            className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deletingStory ? <><Spinner /> Deleting...</> : 'Yes, Delete Permanently'}
          </button>
        </div>
      </Modal>

      <div className="p-8 max-w-4xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-8"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>

        {/* Main/Cover image */}
        <div className="aspect-video w-full rounded-xl overflow-hidden mb-8 bg-dark-card border border-dark-border relative group">
          {story.mainImage ? (
            <>
              <img src={imgUrl(story.mainImage)} alt={story.title} className="w-full h-full object-cover" />
              {isCreator && (
                <button
                  onClick={openCoverImageModal}
                  className="absolute top-3 right-3 p-2.5 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Edit cover image"
                >
                  <CameraIcon />
                </button>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-5xl font-bold text-text-secondary/20 tracking-widest">{story.title}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-4 mb-10">
          {/* Editable Title */}
          {editingTitle ? (
            <div className="space-y-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => { setTitleInput(e.target.value); setTitleError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') handleCancelEditTitle(); }}
                autoFocus
                className="w-full text-4xl font-bold tracking-wide bg-dark-bg border border-dark-border rounded-lg px-4 py-2 text-text-primary focus:outline-none focus:border-primary uppercase"
                placeholder="TWO WORDS"
              />
              {titleError && (
                <p className="text-red-400 text-sm">{titleError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCancelEditTitle}
                  className="px-4 py-2 text-text-secondary text-sm hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTitle}
                  disabled={savingTitle}
                  className="px-4 py-2 bg-primary hover:bg-primary/80 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {savingTitle ? <><Spinner /> Saving...</> : 'Save Title'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 group/title">
              <h1 className="text-4xl font-bold text-text-primary tracking-wide">{story.title}</h1>
              {isCreator && (
                <button
                  onClick={handleStartEditTitle}
                  className="p-2 text-text-secondary hover:text-primary transition-colors opacity-0 group-hover/title:opacity-100"
                  title="Edit title"
                >
                  <PencilIcon />
                </button>
              )}
            </div>
          )}
          <span className={`inline-block px-3 py-1.5 rounded-full text-sm font-medium ${status.colors}`}>
            {status.label}
          </span>
          <div className="flex items-center gap-6 text-text-secondary text-sm pt-2">
            <span>Created by <span className="text-text-primary">{story.creatorName}</span></span>
            <span>{new Date(story.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          {story.prompt && (
            <p className="text-text-secondary text-sm italic">&ldquo;{story.prompt}&rdquo;</p>
          )}
        </div>

        {/* Generate Images Button */}
        {!hasAnyImages && !generating && (
          <div className="mb-8">
            <button
              onClick={handleGenerateImages}
              className="w-full py-4 bg-secondary hover:bg-secondary/80 text-white text-lg font-semibold rounded-xl transition-colors"
            >
              {genDone ? 'Retry Image Generation' : 'Generate All Images'}
            </button>
            <p className="text-text-secondary text-xs text-center mt-2">
              Generates character portraits + scene images for all episodes
            </p>
          </div>
        )}

        {/* Image Generation Progress */}
        {(generating || genDone) && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-6 mb-8">
            <h3 className="text-text-primary font-semibold mb-3">{genPhase}</h3>
            {genCurrent && !genDone && (
              <p className="text-text-secondary text-sm mb-3">Current: {genCurrent}</p>
            )}
            {genError && (
              <div className="mt-2 mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-400 text-sm">{genError}</p>
              </div>
            )}
            {genTotal > 0 && (
              <>
                <div className="h-2 bg-dark-border rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-secondary rounded-full transition-all duration-300" style={{ width: `${(genCompleted / genTotal) * 100}%` }} />
                </div>
                <p className="text-text-secondary text-xs">
                  {genCompleted} / {genTotal} images
                  {genFailed.length > 0 && <span className="text-red-400 ml-2">({genFailed.length} failed)</span>}
                </p>
              </>
            )}
            {generating && genTotal === 0 && !genError && (
              <div className="flex items-center gap-3 mt-2">
                <Spinner size="w-5 h-5" />
                <span className="text-text-secondary text-sm">Connecting to server...</span>
              </div>
            )}
            {genDone && genFailed.length > 0 && !genError && (
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-400 text-sm font-medium mb-1">Failed images:</p>
                {genFailed.map((f, i) => (
                  <p key={i} className="text-red-400/70 text-xs">
                    {f.type === 'character' ? f.name : `Episode ${f.episodeNumber || f.episode}`}: {f.error}
                  </p>
                ))}
              </div>
            )}
            {genDone && !generating && (
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => { clearGeneration(id); handleGenerateImages(); }}
                  className="px-4 py-2 bg-secondary/20 text-secondary text-sm rounded-lg hover:bg-secondary/30 transition-colors"
                >
                  Retry Image Generation
                </button>
                <button
                  onClick={() => clearGeneration(id)}
                  className="px-4 py-2 bg-dark-border text-text-secondary text-sm rounded-lg hover:bg-dark-border/80 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* Hero Profile */}
        {heroProfile && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-6 mb-8">
            <h2 className="text-xl font-bold text-primary mb-4">Hero Profile</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {heroProfile.name && <div><span className="text-text-secondary">Name:</span> <span className="text-text-primary">{heroProfile.name}</span></div>}
              {heroProfile.age && <div><span className="text-text-secondary">Age:</span> <span className="text-text-primary">{heroProfile.age}</span></div>}
              {heroProfile.background && <div className="sm:col-span-2"><span className="text-text-secondary">Background:</span> <span className="text-text-primary">{heroProfile.background}</span></div>}
              {heroProfile.family && <div className="sm:col-span-2"><span className="text-text-secondary">Family:</span> <span className="text-text-primary">{heroProfile.family}</span></div>}
              {heroProfile.personality && <div><span className="text-text-secondary">Personality:</span> <span className="text-text-primary">{heroProfile.personality}</span></div>}
              {heroProfile.weakness && <div><span className="text-text-secondary">Weakness:</span> <span className="text-text-primary">{heroProfile.weakness}</span></div>}
              {heroProfile.strength && <div><span className="text-text-secondary">Strength:</span> <span className="text-text-primary">{heroProfile.strength}</span></div>}
              {heroProfile.goal && <div><span className="text-text-secondary">Goal:</span> <span className="text-text-primary">{heroProfile.goal}</span></div>}
              {heroProfile.currentSituation && <div className="sm:col-span-2"><span className="text-text-secondary">Current Situation:</span> <span className="text-text-primary">{heroProfile.currentSituation}</span></div>}
            </div>
          </div>
        )}

        {/* User Role & Messages */}
        {(story.userRole || story.transitionMessage || story.firstMessage) && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-6 mb-8 space-y-4">
            {story.userRole && (
              <div>
                <h3 className="text-sm font-semibold text-secondary mb-1">User Role</h3>
                <p className="text-text-primary text-sm">{story.userRole}</p>
              </div>
            )}
            {story.transitionMessage && (
              <div>
                <h3 className="text-sm font-semibold text-secondary mb-1">Transition Message</h3>
                <p className="text-text-primary text-sm">{story.transitionMessage}</p>
              </div>
            )}
            {story.firstMessage && (
              <div>
                <h3 className="text-sm font-semibold text-secondary mb-1">First Message</h3>
                <p className="text-text-primary text-sm font-medium">{story.firstMessage}</p>
              </div>
            )}
          </div>
        )}

        {/* Characters — Fix 1: camera icon on hero too */}
        {characters && characters.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-text-primary mb-4">Characters ({characters.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {characters.map((char) => {
                const charImg = char.image;
                return (
                  <div
                    key={char._id}
                    className={`bg-dark-card border rounded-xl overflow-hidden relative group ${
                      char.isHero ? 'border-amber-500/50' : 'border-dark-border'
                    }`}
                  >
                    {char.isHero && (
                      <div className="absolute top-3 right-3 z-10 px-2.5 py-1 bg-amber-500 text-black text-xs font-bold rounded-full shadow-lg tracking-wider">
                        HERO
                      </div>
                    )}
                    {/* Fix 1: Edit button works for ALL characters including hero */}
                    {isCreator && charImg && (
                      <button
                        onClick={() => { openCharacterModal(char); setCharPrompt(''); }}
                        className="absolute top-3 left-3 z-10 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        title={char.isHero ? 'Edit hero image' : 'Edit character image'}
                      >
                        <CameraIcon />
                      </button>
                    )}
                    <div className="aspect-[3/4] w-full overflow-hidden bg-dark-border">
                      {charImg ? (
                        <img src={imgUrl(charImg)} alt={char.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="text-center">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 ${char.isHero ? 'bg-amber-500/20' : 'bg-primary/20'}`}>
                              <span className={`text-2xl font-bold ${char.isHero ? 'text-amber-500' : 'text-primary'}`}>{char.name?.[0]}</span>
                            </div>
                            <span className="text-text-secondary/40 text-xs">No image yet</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      {editingCharName === (char.isHero ? 'hero' : char._id) ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={charNameInput}
                            onChange={(e) => { setCharNameInput(e.target.value); setCharNameError(''); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCharName(char); if (e.key === 'Escape') handleCancelCharNameEdit(); }}
                            autoFocus
                            maxLength={50}
                            className="w-full px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-text-primary text-sm font-semibold focus:outline-none focus:border-primary"
                          />
                          {charNameError && <p className="text-red-400 text-xs">{charNameError}</p>}
                          <div className="flex gap-2">
                            <button onClick={handleCancelCharNameEdit} className="px-3 py-1 text-text-secondary text-xs hover:text-text-primary transition-colors">Cancel</button>
                            <button
                              onClick={() => handleSaveCharName(char)}
                              disabled={savingCharName}
                              className="px-3 py-1 bg-primary hover:bg-primary/80 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                              {savingCharName ? <><Spinner /> Saving</> : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group/charname">
                          <h3 className="text-text-primary font-semibold">{char.name}</h3>
                          {isCreator && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleStartCharNameEdit(char); }}
                              className="p-1 text-text-secondary hover:text-primary transition-colors opacity-0 group-hover/charname:opacity-100"
                              title="Edit name"
                            >
                              <PencilIcon />
                            </button>
                          )}
                        </div>
                      )}
                      <p className={`text-sm ${char.isHero ? 'text-amber-400' : 'text-primary'}`}>{char.role}</p>
                      {char.description && char.description !== char.role && (
                        <p className="text-text-secondary text-xs mt-1">{char.description}</p>
                      )}
                      <p className="text-text-secondary/50 text-xs mt-2">
                        Episodes: {char.appearsInEpisodes?.join(', ')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Episodes — Fix 2: uses modal instead of confirm() */}
        {episodes && episodes.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text-primary">Episodes ({episodes.length})</h2>
              {isCreator && (
                <button
                  onClick={openRegenStoryModal}
                  disabled={regeneratingStory}
                  className="px-4 py-2 bg-red-500/20 text-red-400 text-sm font-medium rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {regeneratingStory ? <><Spinner /> Regenerating...</> : 'Regenerate Full Story'}
                </button>
              )}
            </div>
            <div className="space-y-4">
              {episodes.map((ep) => {
                const sceneImg = ep.sceneImage;
                const isEditing = editingEpisode === ep.episodeNumber;
                return (
                  <div key={ep._id} className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
                    <div className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="bg-primary/20 text-primary text-xs font-bold px-2.5 py-1 rounded-full">
                            EP {ep.episodeNumber}
                          </span>
                          <h3 className="text-text-primary font-semibold">{ep.title}</h3>
                        </div>
                        {isCreator && !isEditing && (
                          <button
                            onClick={() => startEditEpisode(ep.episodeNumber, ep.sceneDetails || '', ep.productionNotes || '')}
                            className="p-2 text-text-secondary hover:text-primary transition-colors"
                            title="Edit episode"
                          >
                            <PencilIcon />
                          </button>
                        )}
                      </div>

                      {ep.characterName && (
                        <p className="text-secondary text-sm mb-2">Character: {ep.characterName}</p>
                      )}

                      {isEditing ? (
                        <div className="space-y-3">
                          <div>
                            <label className="text-text-secondary/60 text-xs uppercase tracking-wider mb-1 block">Scene Details</label>
                            <textarea
                              value={editFields.sceneDetails}
                              onChange={(e) => updateEditField('sceneDetails', e.target.value)}
                              rows={4}
                              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary resize-none text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-text-secondary/60 text-xs uppercase tracking-wider mb-1 block">Production Notes</label>
                            <textarea
                              value={editFields.productionNotes}
                              onChange={(e) => updateEditField('productionNotes', e.target.value)}
                              rows={2}
                              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary resize-none text-sm"
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-xs">
                              {saveStatus === 'saving' && <span className="text-amber-400">Saving...</span>}
                              {saveStatus === 'saved' && <span className="text-emerald-400">Saved &#10003;</span>}
                              {saveStatus === 'error' && <span className="text-red-400">Save failed</span>}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={cancelEditEpisode}
                                className="px-4 py-2 text-text-secondary text-sm hover:text-text-primary transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveEpisode}
                                disabled={savingEpisode}
                                className="px-4 py-2 bg-primary hover:bg-primary/80 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                              >
                                {savingEpisode ? <><Spinner /> Saving...</> : 'Save & Regenerate Scene'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {ep.sceneDetails && (
                            <div className="mb-2">
                              <p className="text-text-secondary/60 text-xs uppercase tracking-wider mb-1">Scene Details</p>
                              <p className="text-text-primary text-sm whitespace-pre-line">{ep.sceneDetails}</p>
                            </div>
                          )}
                          {ep.productionNotes && (
                            <div className="mb-3">
                              <p className="text-text-secondary/60 text-xs uppercase tracking-wider mb-1">Production Notes</p>
                              <p className="text-text-secondary text-sm whitespace-pre-line">{ep.productionNotes}</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {/* Scene Image */}
                    <div className="relative group">
                      {sceneImg ? (
                        <div className="aspect-video w-full overflow-hidden border-t border-dark-border">
                          <img src={imgUrl(sceneImg)} alt={`Scene: ${ep.title}`} className="w-full h-full object-cover" />
                          {isCreator && (
                            <button
                              onClick={() => { openSceneImageModal(ep); setScenePrompt(''); }}
                              className="absolute top-3 right-3 p-2.5 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Edit scene image"
                            >
                              <CameraIcon />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="aspect-video w-full bg-dark-border/50 border-t border-dark-border flex items-center justify-center">
                          <span className="text-text-secondary/30 text-sm">Scene image not generated</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Image Generator (when no cover exists yet) */}
        {!story.mainImage && (hasAnyImages || genDone) && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-6 mb-8">
            <h2 className="text-lg font-bold text-text-primary mb-3">Generate Cover Image</h2>
            <p className="text-text-secondary text-sm mb-4">Describe your cover image for the story</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={mainPrompt}
                onChange={(e) => setMainPrompt(e.target.value)}
                placeholder="e.g. Arjun and Kavya at sunset, city background"
                disabled={generatingMain}
                className="flex-1 px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-secondary"
              />
              <button
                onClick={handleGenerateMainImage}
                disabled={!mainPrompt.trim() || generatingMain}
                className="px-6 py-3 bg-secondary hover:bg-secondary/80 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
              >
                {generatingMain ? <><Spinner /> Generating...</> : 'Generate Cover'}
              </button>
            </div>
          </div>
        )}

        {/* Mark as Complete Button — creator only, always at bottom */}
        {isCreator && (
          <div className="mt-12 mb-4">
            {story.status === 'complete' ? (
              <div className="w-full py-4 bg-dark-card border border-emerald-500/30 text-emerald-400 text-lg font-semibold rounded-xl text-center flex items-center justify-center gap-3">
                <span>Marked as Complete &#10003;</span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.colors}`}>{status.label}</span>
              </div>
            ) : (
              <button
                onClick={() => setShowCompleteConfirm(true)}
                disabled={completingStory}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white text-lg font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {completingStory ? (
                  <><Spinner /> Marking Complete...</>
                ) : (
                  <>
                    <span>Mark as Complete &#10003;</span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${status.colors}`}>{status.label}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Delete Story Button — creator only, very bottom */}
        {isCreator && (
          <div className="mt-6 mb-4">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deletingStory}
              className="w-full py-4 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-lg font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {deletingStory ? <><Spinner /> Deleting Story...</> : 'Delete Story'}
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
