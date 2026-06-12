import { StateCreator } from "zustand";
import { getErrorMessage } from "@/lib/errors";
import { compareStrings } from "@/lib/utils";
import { AppState, AuthSlice } from "../types";
import {
  addAdminEmailAction,
  addEditorEmailAction,
  getAdminEmailsAction,
  getEditorEmailsAction,
  removeAdminEmailAction,
  removeEditorEmailAction,
} from "@/app/actions/admin";

export const createAuthSlice: StateCreator<AppState, [], [], AuthSlice> = (
  set,
  get,
) => ({
  user: null,
  fetchUser: async () => {
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json();
        set({ user: data.user });
      } else {
        set({ user: null });
      }
    } catch {
      set({ user: null });
    }
  },
  adminEmails: [],
  isFetchingAdmins: false,
  fetchAdminEmails: async () => {
    set({ isFetchingAdmins: true });
    try {
      const emails = await getAdminEmailsAction();
      set({ adminEmails: emails });
    } catch (error: unknown) {
      get().addToast({
        message: getErrorMessage(error, "Error"),
        type: "error",
      });
    } finally {
      set({ isFetchingAdmins: false });
    }
  },
  addAdminEmail: async (email: string) => {
    try {
      const result = await addAdminEmailAction(email);
      set((state: AppState) => ({
        adminEmails: [...state.adminEmails, result.email].sort(compareStrings),
      }));
      get().addToast({ message: result.message, type: "success" });
    } catch (error: unknown) {
      get().addToast({
        message: getErrorMessage(error, "Error"),
        type: "error",
      });
    }
  },
  removeAdminEmail: async (email: string) => {
    const originalAdmins = get().adminEmails;
    set((state: AppState) => ({
      adminEmails: state.adminEmails.filter(
        (adminEmail: string) => adminEmail !== email,
      ),
    }));
    try {
      const result = await removeAdminEmailAction(email);
      get().addToast({ message: result.message, type: "success" });
    } catch (error: unknown) {
      get().addToast({
        message: getErrorMessage(error, "Error"),
        type: "error",
      });
      set({ adminEmails: originalAdmins });
    }
  },
  editorEmails: [],
  isFetchingEditors: false,
  fetchEditorEmails: async () => {
    set({ isFetchingEditors: true });
    try {
      const emails = await getEditorEmailsAction();
      set({ editorEmails: emails });
    } catch (error: unknown) {
      get().addToast({
        message: getErrorMessage(error, "Error"),
        type: "error",
      });
    } finally {
      set({ isFetchingEditors: false });
    }
  },
  addEditorEmail: async (email: string) => {
    try {
      const result = await addEditorEmailAction(email);
      set((state: AppState) => ({
        editorEmails: [...state.editorEmails, result.email].sort(
          compareStrings,
        ),
      }));
      get().addToast({ message: result.message, type: "success" });
    } catch (error: unknown) {
      get().addToast({
        message: getErrorMessage(error, "Error"),
        type: "error",
      });
    }
  },
  removeEditorEmail: async (email: string) => {
    const originalEditors = get().editorEmails;
    set((state: AppState) => ({
      editorEmails: state.editorEmails.filter((e: string) => e !== email),
    }));
    try {
      const result = await removeEditorEmailAction(email);
      get().addToast({ message: result.message, type: "success" });
    } catch (error: unknown) {
      get().addToast({
        message: getErrorMessage(error, "Error"),
        type: "error",
      });
      set({ editorEmails: originalEditors });
    }
  },
  isLocalStorageUnlocked: false,
  unlockLocalStorage: async (password: string) => {
    try {
      const response = await fetch("/api/auth/local/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        set({ isLocalStorageUnlocked: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
  lockLocalStorage: async () => {
    try {
      await fetch("/api/auth/local/logout", { method: "POST" });
      set({ isLocalStorageUnlocked: false });
      return true;
    } catch {
      return false;
    }
  },
  checkLocalStorageAuth: async () => {
    try {
      const response = await fetch("/api/auth/local/check");
      if (response.ok) {
        set({ isLocalStorageUnlocked: true });
      } else {
        set({ isLocalStorageUnlocked: false });
      }
    } catch {
      set({ isLocalStorageUnlocked: false });
    }
  },
  isGoogleAuthHealthy: true,
  googleAuthError: null,
  setGoogleAuthHealth: (isHealthy: boolean, error: string | null = null) => {
    set({ isGoogleAuthHealthy: isHealthy, googleAuthError: error });
  },
});
