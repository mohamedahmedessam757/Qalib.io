import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
  // Prevent Accept-Language / cookie fights that can flash-redirect on first load
  localeDetection: false,
});
