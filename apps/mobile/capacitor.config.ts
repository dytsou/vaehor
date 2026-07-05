import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zeeindex.mobile",
  appName: "Zee Index",
  webDir: "dist",
  server: {
    // ponytail: set url to dev machine LAN IP during R18 device testing only
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
