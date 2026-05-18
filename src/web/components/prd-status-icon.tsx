import {
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePlayIcon,
  CircleSlash2Icon,
  Clock3Icon,
  RefreshCcwDotIcon,
  type LucideProps,
} from "lucide-react";

import type { PrdStatus } from "#/shared/validator";

const ICONS: Record<PrdStatus, React.ComponentType<LucideProps>> = {
  draft: CircleDashedIcon,
  ready: CirclePlayIcon,
  in_progress: Clock3Icon,
  done: CircleCheckIcon,
  canceled: CircleSlash2Icon,
  review: RefreshCcwDotIcon,
};

const CLASS_NAMES: Record<PrdStatus, string> = {
  draft: "text-status-draft",
  ready: "text-status-ready",
  in_progress: "text-status-in-progress",
  done: "text-status-done",
  canceled: "text-status-canceled",
  review: "text-info",
};

export function PrdStatusIcon({ status, className }: { status: PrdStatus; className?: string }) {
  const Icon = ICONS[status];
  return <Icon className={["size-4", CLASS_NAMES[status], className].filter(Boolean).join(" ")} />;
}
