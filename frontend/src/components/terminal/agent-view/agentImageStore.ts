/**
 * The image viewer's state and the helpers the agent view's images share
 * (ticket CORT-62); the components are in `AgentImages.tsx`.
 */
import { createContext } from 'react';
import { create } from 'zustand';
import type { AgentImage } from '@/types';

export interface ViewerImage {
  src: string;
  alt?: string;
}

interface LightboxState {
  images: ViewerImage[];
  index: number;
  open: (images: ViewerImage[], index: number) => void;
  close: () => void;
  step: (delta: number) => void;
}

export const useLightbox = create<LightboxState>()((set) => ({
  images: [],
  index: 0,
  open: (images, index) => set({ images, index }),
  close: () => set({ images: [], index: 0 }),
  step: (delta) => set((s) => (s.images.length ? { index: (s.index + delta + s.images.length) % s.images.length } : s)),
}));

export function dataUrl(image: AgentImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

/** The directory relative image paths are read from (the agent's cwd). */
export const AgentCwdContext = createContext<string>('');
