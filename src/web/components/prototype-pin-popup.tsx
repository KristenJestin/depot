import * as React from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/web/components/ui/button";
import { Textarea } from "#/web/components/ui/textarea";

/**
 * Anchored popup shown when the iframe shim reports a pinned click in the
 * prototype workspace (PRD 0025 / T1). The popup is positioned at the click
 * point received from the iframe shim, clamped so it never spills outside the
 * wrapper. Cmd/Ctrl+Enter submits, Escape cancels. The textarea autofocuses on
 * mount so the user can type immediately.
 *
 * Pure presentational component — the parent owns the feedback mutation and
 * passes `onSubmit` / `onCancel`. We deliberately do not call `fetch` from
 * here: that keeps the popup easy to test in isolation and lets the parent
 * decide how to invalidate queries.
 */

export type PinPopupState = {
  selector: string;
  x: number;
  y: number;
};

export function PinPopup({
  pin,
  wrapperRef,
  onCancel,
  onSubmit,
  pending,
}: {
  pin: PinPopupState;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void> | void;
  pending: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const POPUP_W = 300;
  const POPUP_H = 180;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const wrapperRect = wrapperRef.current?.getBoundingClientRect();
  const popupWidth = Math.max(0, Math.min(POPUP_W, (wrapperRect?.width ?? POPUP_W) - 16));
  const maxLeft = Math.max(8, (wrapperRect?.width ?? popupWidth) - popupWidth - 8);
  const maxTop = Math.max(8, (wrapperRect?.height ?? POPUP_H) - POPUP_H - 8);
  const left = Math.min(Math.max(8, pin.x), maxLeft);
  const top = Math.min(Math.max(8, pin.y), maxTop);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    void onSubmit(trimmed);
  }

  return (
    <div
      data-testid="pin-popup"
      role="dialog"
      aria-label="Add pinned feedback"
      className="absolute z-20 rounded-lg border border-primary bg-card p-2.5 shadow-xl"
      style={{ left, top, width: popupWidth }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Pin sur
      </div>
      <div
        className="break-all rounded px-1.5 py-1 font-mono text-[10px] text-primary"
        style={{ background: "var(--primary-soft)" }}
        data-testid="pin-popup-selector"
      >
        {pin.selector}
      </div>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Décris ton retour…"
        className="mt-2 min-h-[60px] text-xs"
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!text.trim() || pending}
          onClick={submit}
        >
          + feedback
        </Button>
      </div>
    </div>
  );
}
