"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      theme="dark"
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "glass-strong border-line text-foreground font-sans",
        },
      }}
    />
  );
}
