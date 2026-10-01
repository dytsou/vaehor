export function mobileThemeColors(isDark: boolean) {
  return isDark
    ? {
        background: "#111827",
        surface: "#1f2937",
        foreground: "#f9fafb",
        muted: "#9ca3af",
        border: "#374151",
      }
    : {
        background: "#f8fafc",
        surface: "#ffffff",
        foreground: "#111827",
        muted: "#64748b",
        border: "#e2e8f0",
      };
}
