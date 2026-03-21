import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string for serialization
}

interface AIChatState {
  messages: ChatMessage[];
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearMessages: () => void;
  setMessages: (messages: ChatMessage[]) => void;
}

const initialMessage: ChatMessage = {
  id: '1',
  role: 'assistant',
  content: "Hello! I'm your AI assistant. I can help you with Laravel development, explain code, generate migrations, and more. What would you like to work on?",
  timestamp: new Date().toISOString(),
};

export const useAIChatStore = create<AIChatState>()(
  persist(
    (set) => ({
      messages: [initialMessage],

      addMessage: (message) =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              ...message,
              id: Date.now().toString(),
              timestamp: new Date().toISOString(),
            },
          ],
        })),

      clearMessages: () =>
        set({
          messages: [initialMessage],
        }),

      setMessages: (messages) => set({ messages }),
    }),
    {
      name: 'ai-chat-storage',
    }
  )
);
