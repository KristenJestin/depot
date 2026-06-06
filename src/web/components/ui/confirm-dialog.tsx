import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

import { Button } from "#/web/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
};

/**
 * Modal confirmation dialog built on base-ui Dialog. Mirrors the
 * `SideDrawer` primitive's transition style (`data-[starting-style]` /
 * `data-[ending-style]` driven `animate-in` / `animate-out` utilities)
 * so opening and closing fade and slide in step with the rest of the app.
 *
 * Use for any "are you sure?" prompt — pass `destructive` to render the
 * confirm button with the red destructive treatment.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity duration-200 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-card-border bg-card p-5 shadow-card-hover transition-[opacity,transform] duration-200 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close
              render={(props) => (
                <Button {...props} type="button" variant="ghost" size="sm" disabled={loading}>
                  {cancelLabel}
                </Button>
              )}
            />
            <Button
              type="button"
              variant={destructive ? "destructive" : "primary"}
              size="sm"
              disabled={loading}
              onClick={() => {
                void onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
