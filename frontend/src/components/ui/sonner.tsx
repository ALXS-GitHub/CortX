import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** Follows the `dark` class on <html> (set by the appearance settings). */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return dark
}

const Toaster = ({ ...props }: ToasterProps) => {
  const dark = useIsDark()

  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-st-done" />,
        info: <InfoIcon className="size-4 text-st-open" />,
        warning: <TriangleAlertIcon className="size-4 text-st-progress" />,
        error: <OctagonXIcon className="size-4 text-st-blocked" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--bg-glass)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border-strong)",
          "--border-radius": "var(--radius-md)",
          "--width": "360px",
        } as React.CSSProperties
      }
      // A toast on top sits under the title bar, not over the window
      // controls; the other sides keep sonner's 24px.
      offset={{ top: "calc(var(--titlebar-h) + 12px)" }}
      toastOptions={{
        classNames: {
          toast: "cn-toast bg-popover shadow-pop! font-sans! text-[13px]!",
          description: "text-muted-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
