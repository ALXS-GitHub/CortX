import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Halcyon pill. `secondary` is the neutral default for counts and metadata;
 * `default` is accent-tinted; use <Chip> (ui/Chip) for colour-coded labels.
 */
/* Private to this file: a component module that also exports something
   else stops fast-refreshing, and nothing outside ever used it. */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors [&>svg]:size-3! [&>svg]:pointer-events-none group/badge",
  {
    variants: {
      variant: {
        default:
          "border-accent-border bg-accent text-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-[color-mix(in_srgb,var(--destructive)_36%,var(--border))] bg-destructive/12 text-destructive",
        success:
          "border-[color-mix(in_srgb,var(--success)_36%,var(--border))] bg-success/14 text-[color-mix(in_srgb,var(--success)_72%,var(--foreground))]",
        warning:
          "border-[color-mix(in_srgb,var(--warning)_36%,var(--border))] bg-warning/14 text-[color-mix(in_srgb,var(--warning)_72%,var(--foreground))]",
        info:
          "border-[color-mix(in_srgb,var(--info)_36%,var(--border))] bg-info/14 text-[color-mix(in_srgb,var(--info)_72%,var(--foreground))]",
        outline:
          "border-border-strong bg-transparent text-muted-foreground",
        ghost:
          "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge }
