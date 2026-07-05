import type { CapacitorConfig } from "@capacitor/cli";

const devServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.zeeindex.mobile",
  appName: "Zee Index",
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
    scheme: "Zee Index",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
