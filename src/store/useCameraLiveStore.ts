import { create } from "zustand";

interface CameraLiveState {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  isDragging: boolean;
  setLiveCamera: (state: Partial<Omit<CameraLiveState, "setLiveCamera">>) => void;
}

export const useCameraLiveStore = create<CameraLiveState>((set) => ({
  px: 0,
  py: 0,
  pz: 0,
  tx: 0,
  ty: 0,
  tz: 0,
  fov: 0,
  isDragging: false,
  setLiveCamera: (state) => set((prev) => ({ ...prev, ...state })),
}));
