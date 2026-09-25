# vaehor app assets

`icon.svg` is the source for the Android and iOS launcher icons and splash screens. It uses the same VA paths as `app/icon.svg` and `apps/mobile/public/icon.svg`, with extra space around the mark so square launcher icons do not crop it.

After changing the SVG, regenerate native assets from `apps/mobile`:

```sh
pnpm cap:assets
```

Review the generated launcher icons and splash screens before release. See [`docs/mobile/artifact-release.md`](../../../docs/mobile/artifact-release.md).
