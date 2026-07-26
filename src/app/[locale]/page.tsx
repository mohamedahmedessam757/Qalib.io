"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight, FilePenLine, ShieldCheck, Zap } from "lucide-react";
import { AppShell } from "@/components/ui/AppShell";
import { Button } from "@/components/ui/Button";
import { DocMark } from "@/components/ui/DocMark";

export default function HomePage() {
  const t = useTranslations("home");
  const tc = useTranslations("common");

  return (
    <AppShell>
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-accent">
            <Zap className="h-3.5 w-3.5" />
            {tc("tagline")}
          </p>

          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.35rem] lg:leading-[1.08]">
            {t("title")}
          </h1>

          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            {t("subtitle")}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/documents">
              <Button size="lg" className="gap-2">
                {t("ctaDocuments")}
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="ghost" className="gap-2">
                <FilePenLine className="h-4 w-4" />
                {t("ctaLogin")}
              </Button>
            </Link>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {[
              { icon: FilePenLine, label: t("featureEdit") },
              { icon: ShieldCheck, label: t("featureSecure") },
            ].map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-muted"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div className="glass-strong relative overflow-hidden rounded-[2rem] p-8 glow-ring">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20 blur-2xl" />
            <div className="absolute -bottom-12 -left-8 h-44 w-44 rounded-full bg-blue-500/20 blur-2xl" />
            <div className="float-soft relative flex justify-center">
              <DocMark className="h-52 w-52" />
            </div>
            <p className="relative mt-6 text-center text-sm text-muted">
              {t("visualCaption")}
            </p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
