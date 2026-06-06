import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/web/components/ui/button";
import { Input } from "#/web/components/ui/input";
import { cn } from "#/web/lib/utils";

/**
 * PRD 0026 / S3 — generic add form shared by the three sidebar widgets.
 * Owns the draft state, trims on submit, validates against an empty value
 * locally and resets the input once `pending` flips back from true to
 * false (i.e. on a successful mutation completion observed by the parent).
 *
 * Pure presentational primitive: no fetching, no React Query.
 */
export type SidebarAddFormProps = {
  placeholder: string;
  ariaLabel: string;
  inputClassName?: string;
  buttonLabel?: string;
  onAdd: (value: string) => void;
  pending?: boolean;
};

export function SidebarAddForm({
  placeholder,
  ariaLabel,
  inputClassName,
  buttonLabel = "Add",
  onAdd,
  pending,
}: SidebarAddFormProps) {
  const [draft, setDraft] = useState("");
  const wasPendingRef = useRef(false);

  // Reset the draft once a pending mutation completes. The parent flips
  // `pending` true → false on success/error; the input is cleared once
  // pending falls back to false (final pending → idle transition).
  useEffect(() => {
    if (wasPendingRef.current && !pending) {
      setDraft("");
    }
    wasPendingRef.current = Boolean(pending);
  }, [pending]);

  const submit = () => {
    const value = draft.trim();
    if (value.length === 0) return;
    onAdd(value);
    // Optimistically clear the draft as well — the parent may not toggle
    // `pending` (e.g. synchronous handlers, tests with no real fetch).
    setDraft("");
  };

  const canSubmit = draft.trim().length > 0 && !pending;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn("h-7 flex-1 text-xs", inputClassName)}
      />
      <Button type="submit" size="sm" disabled={!canSubmit}>
        <PlusIcon className="size-3" />
        {buttonLabel}
      </Button>
    </form>
  );
}
