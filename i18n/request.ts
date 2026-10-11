import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n-config";

/**
 * next-intl request config. Path must stay `i18n/request.ts` so vinext
 * auto-registers the `next-intl/config` alias (createNextIntlPlugin not needed).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  // vinext may leave requestLocale undefined; fall back instead of notFound().
  const locale = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
