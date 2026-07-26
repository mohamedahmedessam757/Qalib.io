import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { AppToaster } from "@/components/ui/AppToaster";
import "../globals.css";

export const metadata: Metadata = {
  title: "Qalib",
  description: "Daily Word document editor",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as "ar" | "en")) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className="h-full bg-[#070b14] antialiased"
      style={{ colorScheme: "dark", backgroundColor: "#070b14" }}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#070b14" />
        <meta name="color-scheme" content="dark" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-full bg-[#070b14] font-sans text-foreground"
        style={{ backgroundColor: "#070b14" }}
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          {children}
          <AppToaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
