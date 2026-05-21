import {
  BookTextIcon,
  FolderGitIcon,
  SettingsIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "#/web/lib/utils";

/**
 * `docs-tree` navigation rail for the project settings page: grouped, icon-led
 * sections that drive which settings pane is shown in the main form area.
 */

export type SettingsSection = "configuration" | "repos" | "directives" | "doc-profiles";

const SETTINGS_SECTIONS: ReadonlyArray<{
  group: string;
  items: ReadonlyArray<{ id: SettingsSection; label: string; icon: LucideIcon }>;
}> = [
  {
    group: "Project",
    items: [
      { id: "configuration", label: "Configuration", icon: SettingsIcon },
      { id: "repos", label: "Repos", icon: FolderGitIcon },
    ],
  },
  {
    group: "Automation",
    items: [
      { id: "directives", label: "Directives", icon: TerminalSquareIcon },
      { id: "doc-profiles", label: "Doc profiles", icon: BookTextIcon },
    ],
  },
];

export function SettingsTree({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <nav className="w-60 shrink-0 overflow-y-auto border-r border-card-border bg-card p-3 text-sm">
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Settings
      </p>
      {SETTINGS_SECTIONS.map((section) => (
        <div key={section.group} className="mt-3">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {section.group}
          </p>
          <ul className="mt-1 space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
