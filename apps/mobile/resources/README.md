# vaehor app assets

`icon.svg` is the editable brand source. Expo uses the generated `icon.png` for the iOS app icon and Android adaptive icon.

After changing the SVG, regenerate the PNG at 1024 × 1024 pixels, then regenerate and inspect both native projects:

```sh
pnpm --filter @vaehor/mobile exec expo prebuild --clean --platform all
```

Review generated launcher icons and launch screens on iOS and Android before release. See [`docs/mobile/artifact-release.md`](../../../docs/mobile/artifact-release.md).
