import api from './api';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export const sendGeminiMessage = async (messages) => {
  const response = await api.post('/gemini/chat', { messages }, {
    headers: { 'x-api-key': GEMINI_API_KEY },
  });
  return response.data;
};
