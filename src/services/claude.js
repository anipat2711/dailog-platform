import api from './api';

const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY;

export const sendClaudeMessage = async (messages) => {
  const response = await api.post('/claude/chat', { messages }, {
    headers: { 'x-api-key': CLAUDE_API_KEY },
  });
  return response.data;
};
