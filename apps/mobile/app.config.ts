import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "vaehor",
  slug: "vaehor",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "vaehor",
  platforms: ["ios", "android"],
  userInterfaceStyle: "automatic",
  icon: "./resources/icon.png",
  plugins: ["expo-router"],
  ios: {
    bundleIdentifier: "com.vaehor.mobile",
    buildNumber: "1",
    supportsTablet: true,
    deploymentTarget: "16.4",
  },
  android: {
    package: "com.vaehor.mobile",
    versionCode: 1,
    targetSdkVersion: 36,
    adaptiveIcon: {
      foregroundImage: "./resources/icon.png",
      backgroundColor: "#f4f7f8",
    },
  },
};

export default config;
