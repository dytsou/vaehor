"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  applyTypeaheadKey,
  handleBackspaceKey,
  isEditableKeyboardTarget,
  moveFocusDown,
  moveFocusUp,
  openFocusedFile,
  type NavigableFile,
} from "@/hooks/keyboard-navigation-utils";

interface UseKeyboardNavigationProps {
  files: NavigableFile[];
  onFileOpen?: (file: NavigableFile) => void;
}

export function useKeyboardNavigation({
  files,
  onFileOpen,
}: UseKeyboardNavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [searchBuffer, setSearchBuffer] = useState("");

  const resetSearchBufferSoon = useCallback(() => {
    const timer = setTimeout(() => setSearchBuffer(""), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex(moveFocusDown(files.length));
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex(moveFocusUp());
          break;
        case "Enter":
          openFocusedFile(focusedIndex, files, router.push, onFileOpen);
          break;
        case "Backspace":
          handleBackspaceKey(
            event,
            searchBuffer,
            pathname ?? "",
            () => setSearchBuffer((previous) => previous.slice(0, -1)),
            () => router.back(),
          );
          break;
        case "Home":
          event.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          event.preventDefault();
          setFocusedIndex(files.length - 1);
          break;
        case "Escape":
          setFocusedIndex(-1);
          setSearchBuffer("");
          break;
        default:
          applyTypeaheadKey(
            event,
            searchBuffer,
            files,
            setSearchBuffer,
            setFocusedIndex,
            resetSearchBufferSoon,
          );
          break;
      }
    },
    [
      files,
      focusedIndex,
      router,
      pathname,
      onFileOpen,
      searchBuffer,
      resetSearchBufferSoon,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    setFocusedIndex(-1);
  }, [pathname]);

  useEffect(() => {
    if (focusedIndex >= 0) {
      const element = document.querySelector(
        `[data-file-index="${focusedIndex}"]`,
      );
      if (element) {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [focusedIndex]);

  return {
    focusedIndex,
    setFocusedIndex,
  };
}
