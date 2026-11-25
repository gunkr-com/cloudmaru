import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-md border border-border-control bg-canvas p-3.5 text-sm leading-[1.7] text-body placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        "aria-invalid:border-warning",
        className
      )}
      {...props}
    />
  )
}

export { Input }
