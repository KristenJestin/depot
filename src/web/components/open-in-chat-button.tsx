import * as React from "react";

import { Button } from "#/web/components/ui/button";

export interface OpenInChatButtonProps {
  slashCommand: string;
  label?: string;
}

/**
 * Copies the given slash command to the clipboard so the user can paste it
 * directly into claude-code or opencode. Level-1 fallback for the web ↔ chat
 * bridge (see PRD 08 for the level-2 pending-actions queue).
 */
export function OpenInChatButton({ slashCommand, label }: OpenInChatButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const onClick = React.useCallback(() => {
    void navigator.clipboard
      .writeText(slashCommand)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setCopied(false));
  }, [slashCommand]);

  return (
    <Button variant="secondary" size="sm" onClick={onClick} title={slashCommand}>
      {copied ? "Copied!" : (label ?? `Open in chat: ${slashCommand}`)}
    </Button>
  );
}
