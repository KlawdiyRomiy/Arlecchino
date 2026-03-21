import { create } from 'zustand';
import { laravel } from '../../wailsjs/go/models';

interface ProjectState {
  structure: laravel.ProjectStructure | null;
  isLoading: boolean;
  error: string | null;
  setStructure: (structure: laravel.ProjectStructure) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  structure: null,
  isLoading: false,
  error: null,
  setStructure: (structure) => set({ structure }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
