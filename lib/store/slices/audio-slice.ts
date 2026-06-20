import { StateCreator } from "zustand";
import type { DriveFile } from "@/lib/drive";
import { AppState, AudioSlice } from "../types";

function getUniqueQueueEntries(
  queue: DriveFile[],
  files: DriveFile[],
): DriveFile[] {
  const queuedIds = new Set(queue.map((file) => file.id));
  return files.filter((file) => !queuedIds.has(file.id));
}

function appendToAudioQueue(
  state: AppState,
  files: DriveFile[],
): Pick<AudioSlice, "audioQueue"> {
  const newFiles = getUniqueQueueEntries(state.audioQueue, files);
  return { audioQueue: [...state.audioQueue, ...newFiles] };
}

function findCurrentTrackIndex(
  activeAudioFile: DriveFile,
  audioQueue: DriveFile[],
): number {
  return audioQueue.findIndex((file) => file.id === activeAudioFile.id);
}

export const createAudioSlice: StateCreator<AppState, [], [], AudioSlice> = (
  set,
  get,
) => ({
  activeAudioFile: null,
  audioQueue: [],
  isAudioPlaying: false,
  playAudio: (file: DriveFile, queue: DriveFile[] = []) =>
    set({
      activeAudioFile: file,
      isAudioPlaying: true,
      audioQueue: queue.length > 0 ? queue : [file],
    }),
  addToQueue: (files: DriveFile[]) =>
    set((state) => appendToAudioQueue(state, files)),
  removeFromQueue: (fileId: string) =>
    set((state: AppState) => ({
      audioQueue: state.audioQueue.filter((file) => file.id !== fileId),
    })),
  playNextTrack: () => {
    const { activeAudioFile, audioQueue } = get();
    if (!activeAudioFile || audioQueue.length === 0) return;

    const currentIndex = findCurrentTrackIndex(activeAudioFile, audioQueue);
    if (currentIndex < audioQueue.length - 1) {
      set({ activeAudioFile: audioQueue[currentIndex + 1] });
    }
  },
  playPrevTrack: () => {
    const { activeAudioFile, audioQueue } = get();
    if (!activeAudioFile || audioQueue.length === 0) return;

    const currentIndex = findCurrentTrackIndex(activeAudioFile, audioQueue);
    if (currentIndex > 0) {
      set({ activeAudioFile: audioQueue[currentIndex - 1] });
    }
  },
  toggleAudioPlay: () =>
    set((state: AppState) => ({ isAudioPlaying: !state.isAudioPlaying })),
  closeAudio: () =>
    set({ activeAudioFile: null, isAudioPlaying: false, audioQueue: [] }),
});
