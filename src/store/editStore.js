import { create } from 'zustand';

const useEditStore = create((set, get) => ({
  // Episode inline editing
  editingEpisode: null, // episodeNumber being edited
  editFields: { sceneDetails: '', productionNotes: '' },
  savingEpisode: false,

  // Modal states
  characterModal: null, // { characterId, name, image, isHero } or null
  sceneImageModal: null, // { episodeNumber, title, sceneImage } or null
  coverImageModal: false,
  regenStoryModal: false, // Fix 2: confirmation modal

  // Loading states
  regeneratingCharImage: false,
  regeneratingSceneImage: false,
  regeneratingCover: false,
  regeneratingStory: false,

  // Fix 3: Cascading scene regen progress
  sceneRegenProgress: null, // { total, completed, current, log: [{ep, status}] } or null

  // Auto-save indicator
  saveStatus: null, // 'saving' | 'saved' | 'error' | null

  // Fix 5: Toast notifications — error toasts persist until dismissed
  toast: null, // { message, type: 'success' | 'error', persistent: bool }
  _toastTimer: null,

  // Actions
  startEditEpisode: (episodeNumber, sceneDetails, productionNotes) =>
    set({ editingEpisode: episodeNumber, editFields: { sceneDetails, productionNotes }, saveStatus: null }),

  updateEditField: (field, value) =>
    set((s) => ({ editFields: { ...s.editFields, [field]: value } })),

  cancelEditEpisode: () =>
    set({ editingEpisode: null, editFields: { sceneDetails: '', productionNotes: '' }, saveStatus: null }),

  setSavingEpisode: (v) => set({ savingEpisode: v }),
  setSaveStatus: (v) => set({ saveStatus: v }),

  openCharacterModal: (character) =>
    set({
      characterModal: {
        characterId: character._id,
        name: character.name,
        image: character.image,
        isHero: character.isHero || false,
      },
      sceneRegenProgress: null,
    }),

  closeCharacterModal: () => set({ characterModal: null, sceneRegenProgress: null }),

  openSceneImageModal: (episode) =>
    set({ sceneImageModal: { episodeNumber: episode.episodeNumber, title: episode.title, sceneImage: episode.sceneImage } }),

  closeSceneImageModal: () => set({ sceneImageModal: null }),

  openCoverImageModal: () => set({ coverImageModal: true }),
  closeCoverImageModal: () => set({ coverImageModal: false }),

  // Fix 2: confirmation modal
  openRegenStoryModal: () => set({ regenStoryModal: true }),
  closeRegenStoryModal: () => set({ regenStoryModal: false }),

  setRegeneratingCharImage: (v) => set({ regeneratingCharImage: v }),
  setRegeneratingSceneImage: (v) => set({ regeneratingSceneImage: v }),
  setRegeneratingCover: (v) => set({ regeneratingCover: v }),
  setRegeneratingStory: (v) => set({ regeneratingStory: v }),

  // Fix 3: Scene regen progress tracking
  initSceneRegenProgress: (total) =>
    set({ sceneRegenProgress: { total, completed: 0, current: 0, log: [] } }),

  updateSceneRegenProgress: (episodeNumber, current, total, status) =>
    set((s) => {
      const log = [...(s.sceneRegenProgress?.log || [])];
      const existing = log.findIndex((l) => l.ep === episodeNumber);
      if (existing >= 0) {
        log[existing] = { ep: episodeNumber, status };
      } else {
        log.push({ ep: episodeNumber, status });
      }
      const completed = log.filter((l) => l.status === 'done' || l.status === 'failed').length;
      return { sceneRegenProgress: { total, completed, current, log } };
    }),

  clearSceneRegenProgress: () => set({ sceneRegenProgress: null }),

  // Fix 5: Toast with persistent error toasts
  showToast: (message, type = 'success') => {
    const state = get();
    if (state._toastTimer) clearTimeout(state._toastTimer);

    if (type === 'error') {
      // Error toasts persist until manually dismissed
      set({ toast: { message, type, persistent: true }, _toastTimer: null });
    } else {
      // Success toasts auto-dismiss after 4 seconds
      const timer = setTimeout(() => set({ toast: null, _toastTimer: null }), 4000);
      set({ toast: { message, type, persistent: false }, _toastTimer: timer });
    }
  },

  dismissToast: () => {
    const state = get();
    if (state._toastTimer) clearTimeout(state._toastTimer);
    set({ toast: null, _toastTimer: null });
  },
}));

export default useEditStore;
