import { Drawer } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  ariaLabel?: string;
};

/**
 * Right-side slide-out drawer built on base-ui Drawer.
 * Animates via tw-animate-css's `animate-in` / `animate-out` utilities,
 * triggered by the `data-[starting-style]` / `data-[ending-style]` attrs
 * that base-ui sets during mount / unmount transitions.
 */
export function SideDrawer({ open, onOpenChange, children, ariaLabel }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)} swipeDirection="right">
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Drawer.Popup
          aria-label={ariaLabel ?? "Drawer"}
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-card-border bg-card shadow-card-hover transition-transform duration-350 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full"
        >
          {children}
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function SideDrawerCloseButton() {
  return (
    <Drawer.Close
      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Close drawer"
    >
      <XIcon className="size-4" />
    </Drawer.Close>
  );
}

export const SideDrawerTitle = Drawer.Title;
export const SideDrawerDescription = Drawer.Description;
