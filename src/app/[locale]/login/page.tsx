"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { motion } from "motion/react";
import { KeyRound, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/ui/AppShell";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

const easeOut = [0.23, 1, 0.32, 1] as const;

export default function LoginPage() {
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      toast.success(t("confirmEmail"));
      return;
    }
    toast.success(tc("login"));
    router.replace("/documents");
    router.refresh();
  }

  return (
    <AppShell showNav={false}>
      <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center">
        <motion.div
          initial={{ y: 12, scale: 0.98 }}
          animate={{ y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: easeOut }}
          className="glass-strong rounded-[1.75rem] p-6 sm:p-8 glow-ring"
        >
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm text-muted">{tc("appName")}</p>
              <p className="font-medium">{t("title")}</p>
            </div>
          </div>

          <PageHeader title={t("title")} description={t("hint")} />

          <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-muted">{t("email")}</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-line bg-white/5 py-2.5 pe-3 ps-10 text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted/60 focus:border-accent/50 focus:shadow-[0_0_0_3px_rgba(45,212,191,0.15)]"
                />
              </div>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-muted">{t("password")}</span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-line bg-white/5 py-2.5 pe-3 ps-10 text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted/60 focus:border-accent/50 focus:shadow-[0_0_0_3px_rgba(45,212,191,0.15)]"
                />
              </div>
            </label>
            <Button
              type="submit"
              disabled={loading}
              className="mt-2 min-h-12 w-full"
            >
              {loading
                ? tc("loading")
                : mode === "signin"
                  ? t("submit")
                  : t("createAccount")}
            </Button>
            <button
              type="button"
              className="min-h-11 text-sm text-muted transition-colors duration-200 hover:text-foreground"
              onClick={() =>
                setMode((m) => (m === "signin" ? "signup" : "signin"))
              }
            >
              {mode === "signin" ? t("needAccount") : t("haveAccount")}
            </button>
          </form>
        </motion.div>
      </div>
    </AppShell>
  );
}
