import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-sm border border-input bg-[var(--bg-input)] px-3 py-2 text-sm shadow-soft transition-[color,box-shadow,border-color] outline-none",
        "placeholder:text-faint focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-ring/40",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
