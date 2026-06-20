import api from './api';

export const generateStory = async ({ prompt, userCharacter, title }) => {
  const response = await api.post('/stories/generate', { prompt, userCharacter, title });
  return response.data;
};

export const getAllStories = async () => {
  const response = await api.get('/stories');
  return response.data;
};

export const getStoryById = async (id) => {
  const response = await api.get(`/stories/${id}`);
  return response.data;
};

export const updateEpisode = async (storyId, episodeNumber, data) => {
  const response = await api.put(`/stories/${storyId}/episode/${episodeNumber}`, data);
  return response.data;
};

export const deleteStory = async (id) => {
  const response = await api.delete(`/stories/${id}`);
  return response.data;
};

// Start background image generation (returns immediately)
export const startImageGeneration = async (storyId) => {
  const response = await api.post(`/images/${storyId}/generate`);
  return response.data;
};

// Poll generation status
export const getImageGenerationStatus = async (storyId) => {
  const response = await api.get(`/images/${storyId}/status`);
  return response.data;
};

export const generateMainImage = async (storyId, prompt) => {
  const response = await api.post(`/images/${storyId}/main-image`, { prompt });
  return response.data;
};

// Phase 7 — Editing endpoints

export const regenerateStory = async (storyId) => {
  const response = await api.post(`/stories/${storyId}/regenerate`);
  return response.data;
};

// SSE helper for PUT endpoints that stream progress
function sseRequest(url, body, onEvent) {
  const token = localStorage.getItem('token');
  const baseURL = import.meta.env.VITE_API_BASE_URL || 'https://dailog-platform-api.onrender.com';
  const fullUrl = `${baseURL}/api${url}`;

  return new Promise((resolve, reject) => {
    fetch(fullUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Server returned ${response.status}: ${text}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let resolved = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                onEvent(data);
                if ((data.type === 'done' || data.type === 'error') && !resolved) {
                  resolved = true;
                  resolve(data);
                }
              } catch (parseErr) {
                console.warn('[SSE] Parse error:', line, parseErr);
              }
            }
          }
        }
        if (!resolved) resolve({ type: 'done' });
      })
      .catch((err) => {
        console.error('[SSE] Fetch failed:', err);
        reject(err);
      });
  });
}

// SSE-based character image regeneration with cascading scene progress
export function regenerateCharacterImage(storyId, characterId, prompt, onEvent) {
  return sseRequest(`/images/${storyId}/character/${characterId}/image`, { prompt }, onEvent);
}

// SSE-based hero image regeneration with cascading scene progress
export function regenerateHeroImage(storyId, prompt, onEvent) {
  return sseRequest(`/images/${storyId}/hero/image`, { prompt }, onEvent);
}

export const regenerateSceneImage = async (storyId, episodeNumber, prompt) => {
  const response = await api.put(`/images/${storyId}/episode/${episodeNumber}/scene-image`, { prompt });
  return response.data;
};

// Character name edit
export const updateCharacterName = async (storyId, characterId, newName) => {
  const response = await api.put(`/stories/${storyId}/character/${characterId}/name`, { newName });
  return response.data;
};

// Hero name edit
export const updateHeroName = async (storyId, newName) => {
  const response = await api.put(`/stories/${storyId}/hero/name`, { newName });
  return response.data;
};

// Feature 1: Update story title
export const updateStoryTitle = async (storyId, title) => {
  const response = await api.put(`/stories/${storyId}/title`, { title });
  return response.data;
};

// Feature 2: Mark story as complete
export const markStoryComplete = async (storyId) => {
  const response = await api.put(`/stories/${storyId}/complete`);
  return response.data;
};

// Feature 2: Update story status
export const updateStoryStatus = async (storyId, status) => {
  const response = await api.put(`/stories/${storyId}/status`, { status });
  return response.data;
};
