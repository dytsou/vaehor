import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  plugins: [vinext()],
  // nextjs-toploader (and similar CJS default exports) break under Vite 8's
  // stricter interop → "Element type is invalid … got: undefined" on SSR.
  legacy: {
    inconsistentCjsInterop: true,
  },
  optimizeDeps: {
    // vinext warning: NextIntlClientProvider was inconsistently optimized
    exclude: ["next-intl"],
  },
  // jwa → buffer-equal-constant-time expects Node Buffer; keep those pkgs external
  // so they load in Node instead of a Buffer-less SSR bundle.
  ssr: {
    external: [
      "buffer-equal-constant-time",
      "jwa",
      "jws",
      "jsonwebtoken",
      "google-auth-library",
      "googleapis",
    ],
  },
});
