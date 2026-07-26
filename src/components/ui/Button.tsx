import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-[transform,background-color,box-shadow,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 touch-manipulation",
  {
    variants: {
      variant: {
        solid:
          "bg-accent text-[#042f2e] shadow-[0_10px_30px_rgba(45,212,191,0.25)] hover:bg-accent-hover",
        ghost:
          "glass text-foreground hover:border-accent/40 hover:bg-white/10",
        danger:
          "bg-danger/90 text-white hover:bg-danger shadow-[0_10px_28px_rgba(251,113,133,0.25)]",
      },
      size: {
        sm: "min-h-9 rounded-lg px-3 py-1.5 text-xs sm:min-h-0",
        md: "min-h-11 px-4 py-2.5 text-sm sm:min-h-0",
        lg: "min-h-12 px-5 py-3 text-base",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
