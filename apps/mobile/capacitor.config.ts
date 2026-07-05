import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zeeindex.mobile",
  appName: "Zee Index",
  webDir: "dist",
  server: {
    // ponytail: set url to dev machine LAN IP during R18 device testing only
    cleartext: true,
  },
};

export default config;
