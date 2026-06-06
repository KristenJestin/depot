import * as React from "react";

import { Badge } from "#/web/components/ui/badge";
import { Button } from "#/web/components/ui/button";

// Full doc-profile shape returned by `GET /api/projects/:id/doc-profiles/:name`
// — the JSON columns are already parsed into arrays by the API.
export type DocSource = {
  name: string;
  path: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
};
export type RoutingRule = { sourcePathGlob: string; targetDocPath: string; when?: string };

export type DocProfileDetail = {
  id: string;
  name: string;
  projectId: string;
  targetRoot: string;
  targetPattern: string;
  language: string;
  style: string;
  audience: string | null;
  commitPolicy: string;
  sources: DocSource[];
  routingRules: RoutingRule[];
  topicsToCover: string[];
  topicsToIgnore: string[];
  guardrails: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

/**
 * Doc-profile drill-in detail (PRD 0021 / T5). Surfaces every metadata field a
 * `depot doc profile show` would print — target root/pattern, sources,
 * language/style/audience, routing rules, topics to cover/ignore, guardrails,
 * commit policy — so the user never has to drop to the CLI to inspect a
 * profile. The Edit action is wired by the caller to the `doc profile set` API.
 */
export function DocProfileDetailView({
  profile,
  onEdit,
}: {
  profile: DocProfileDetail;
  onEdit?: () => void;
}) {
  return (
    <article className="space-y-6" data-testid="doc-profile-detail">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-semibold">{profile.name}</h1>
          <Badge variant="outline" className="text-[10px]">
            {profile.style}
          </Badge>
          <Badge variant="subtle" className="text-[10px]">
            {profile.commitPolicy}
          </Badge>
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
          <Field label="Target root">
            <code>{profile.targetRoot}</code>
          </Field>
          <Field label="Target pattern">
            <code>{profile.targetPattern}</code>
          </Field>
          <Field label="Language">{profile.language}</Field>
          <Field label="Style">{profile.style}</Field>
          <Field label="Audience">{profile.audience ?? "—"}</Field>
          <Field label="Commit policy">{profile.commitPolicy}</Field>
        </dl>
      </header>

      <Section title="Sources">
        {profile.sources.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1">
            {profile.sources.map((s) => (
              <li key={`${s.name}:${s.path}`} className="flex items-baseline gap-2 text-sm">
                <span className="font-medium">{s.name}</span>
                <code className="text-[11px] text-muted-foreground">{s.path}</code>
                {s.includeGlobs && s.includeGlobs.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    include: {s.includeGlobs.join(", ")}
                  </span>
                )}
                {s.excludeGlobs && s.excludeGlobs.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    exclude: {s.excludeGlobs.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Routing rules">
        {profile.routingRules.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1">
            {profile.routingRules.map((r, i) => (
              <li key={`${r.sourcePathGlob}:${i}`} className="text-sm">
                <code className="text-[11px] text-muted-foreground">{r.sourcePathGlob}</code>
                <span aria-hidden="true" className="mx-1 text-muted-foreground">
                  →
                </span>
                <code className="text-[11px] text-muted-foreground">{r.targetDocPath}</code>
                {r.when && (
                  <span className="ml-2 text-[11px] text-muted-foreground">when {r.when}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-6 sm:grid-cols-2">
        <Section title="Topics to cover">
          <ChipList items={profile.topicsToCover} />
        </Section>
        <Section title="Topics to ignore">
          <ChipList items={profile.topicsToIgnore} />
        </Section>
      </div>

      <Section title="Guardrails">
        {profile.guardrails.length === 0 ? (
          <Empty />
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm">
            {profile.guardrails.map((g, i) => (
              <li key={`${i}:${g}`}>{g}</li>
            ))}
          </ul>
        )}
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="rounded-md border border-card-border bg-card p-3">{children}</div>
    </section>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty />;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <Badge key={`${i}:${t}`} variant="subtle" className="text-[10px]">
          {t}
        </Badge>
      ))}
    </div>
  );
}

function Empty() {
  return <span className="text-xs text-muted-foreground">—</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
      <span className="text-xs text-foreground">{children}</span>
    </div>
  );
}
