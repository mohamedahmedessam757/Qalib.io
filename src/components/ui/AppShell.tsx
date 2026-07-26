"use client";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FileText, Languages, LogOut, Sparkles } from "lucide-react";
import { Button } from "./Button";
import { createClient } from "@/lib/supabase/client";

export function AppShell({
  children,
  showNav = true,
}: {
  children: ReactNode;
  showNav?: boolean;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const other = locale === "ar" ? "en" : "ar";

  async function onLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -left-24 top-10 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -right-16 top-40 h-72 w-72 rounded-full bg-blue-500/15 blur-3xl" />
      </div>

      {showNav ? (
        <div className="sticky top-0 z-40 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 sm:pt-3">
          <div className="glass mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 rounded-2xl px-2 sm:gap-3 sm:px-4">
            <Link href="/" className="flex min-h-11 items-center gap-2.5 px-1">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent glow-ring">
                <Sparkles className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="text-base font-semibold tracking-tight">
                {t("appName")}
              </span>
            </Link>
            <nav className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/documents"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted transition-colors duration-200 hover:bg-white/5 hover:text-foreground"
              >
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">{t("documents")}</span>
              </Link>
              <Link href={pathname} locale={other}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 gap-1.5 sm:min-h-0 sm:min-w-0"
                >
                  <Languages className="h-3.5 w-3.5" />
                  {other.toUpperCase()}
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={onLogout}
                className="min-h-11 min-w-11 gap-1.5 sm:min-h-0 sm:min-w-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("logout")}</span>
              </Button>
            </nav>
          </div>
        </div>
      ) : null}

      <main className="page-enter mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
