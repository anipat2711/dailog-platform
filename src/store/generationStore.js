import { create } from 'zustand';
import api from '../services/api';

const POLL_INTERVAL = 3000; // 3 seconds

const useGenerationStore = create((set, get) => ({
  // storyId → { status, phase, current, completed, total, failed, error }
  activeGenerations: {},
  // storyId → intervalId
  _pollTimers: {},

  // Get status for a specific story
  getStatus: (storyId) => get().activeGenerations[storyId] || null,

  // Start image generation + polling
  startGeneration: async (storyId) => {
    try {
      // Kick off background generation on server
      await api.post(`/images/${storyId}/generate`);

      // Set initial state
      set((s) => ({
        activeGenerations: {
          ...s.activeGenerations,
          [storyId]: {
            status: 'running',
            phase: 'Starting...',
            current: '',
            completed: 0,
            total: 0,
            failed: [],
            error: null,
          },
        },
      }));

      // Start polling
      get().startPolling(storyId);
    } catch (err) {
      set((s) => ({
        activeGenerations: {
          ...s.activeGenerations,
          [storyId]: {
            status: 'failed',
            phase: 'Failed to start',
            current: '',
            completed: 0,
            total: 0,
            failed: [],
            error: err.message || 'Failed to start image generation',
          },
        },
      }));
    }
  },

  // Start polling for a story
  startPolling: (storyId) => {
    const state = get();
    // Don't start duplicate polling
    if (state._pollTimers[storyId]) return;

    const poll = async () => {
      try {
        const response = await api.get(`/images/${storyId}/status`);
        const data = response.data;

        set((s) => ({
          activeGenerations: {
            ...s.activeGenerations,
            [storyId]: data,
          },
        }));

        // Stop polling if done or failed
        if (data.status === 'complete' || data.status === 'failed') {
          get().stopPolling(storyId);
        }
      } catch {
        // If status endpoint fails (e.g. no active generation), stop polling
        get().stopPolling(storyId);
      }
    };

    // Poll immediately, then every 3 seconds
    poll();
    const timerId = setInterval(poll, POLL_INTERVAL);
    set((s) => ({
      _pollTimers: { ...s._pollTimers, [storyId]: timerId },
    }));
  },

  // Stop polling for a story
  stopPolling: (storyId) => {
    const state = get();
    const timerId = state._pollTimers[storyId];
    if (timerId) {
      clearInterval(timerId);
      set((s) => {
        const timers = { ...s._pollTimers };
        delete timers[storyId];
        return { _pollTimers: timers };
      });
    }
  },

  // Clear generation status for a story (after user dismisses)
  clearGeneration: (storyId) => {
    get().stopPolling(storyId);
    set((s) => {
      const gens = { ...s.activeGenerations };
      delete gens[storyId];
      return { activeGenerations: gens };
    });
  },

  // Check if a story has an active generation running on server
  // Called when StoryDetail mounts to resume showing progress
  checkAndResume: async (storyId) => {
    const state = get();
    // Already tracking this one
    if (state.activeGenerations[storyId]?.status === 'running') {
      if (!state._pollTimers[storyId]) {
        get().startPolling(storyId);
      }
      return;
    }

    try {
      const response = await api.get(`/images/${storyId}/status`);
      const data = response.data;
      if (data.status === 'running') {
        set((s) => ({
          activeGenerations: {
            ...s.activeGenerations,
            [storyId]: data,
          },
        }));
        get().startPolling(storyId);
      } else if (data.status === 'complete' || data.status === 'failed') {
        // Generation finished while we were away — store the result
        set((s) => ({
          activeGenerations: {
            ...s.activeGenerations,
            [storyId]: data,
          },
        }));
      }
    } catch {
      // No active generation — that's fine
    }
  },
}));

export default useGenerationStore;
