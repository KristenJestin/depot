export function AgentBars() {
  return (
    <span className="flex h-3 items-end gap-px" aria-hidden="true">
      <span className="h-1.5 w-1 rounded-full bg-current animate-pulse" />
      <span className="h-2.5 w-1 rounded-full bg-current animate-pulse" />
      <span className="h-2 w-1 rounded-full bg-current animate-pulse" />
    </span>
  );
}
