import type { CapacitorConfig } from "@capacitor/cli";

const devServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.vaehor.mobile",
  appName: "vaehor",
  webDir: "dist",
  server: devServerUrl
    ? {
        url: devServerUrl,
        cleartext: devServerUrl.startsWith("http://"),
      }
    : {
        cleartext: true,
      },
  plugins: {
    App: {
      appUrlOpen: {
        enabled: true,
      },
    },
  },
  ios: {
    scheme: "vaehor",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
