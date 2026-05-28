import { Schema, Effect } from "effect";
import { command, type CommandOutput } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainProjects from "#/modules/projects/domain";
import * as DomainWorkspaces from "#/modules/workspaces/domain";
import { normalizeWorkspacePath, formatDate } from "#/shared/utils";
import { VALID_PROJECT_STATUSES } from "#/shared/validator";
import * as path from "node:path";
import { detectGitContext } from "#/modules/workspaces/bootstrap";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import * as DomainProjectConfig from "#/modules/projects/config";
import * as DomainDirectives from "#/modules/projects/directives";
import * as DomainRepos from "#/modules/projects/repos";
import { existsSync } from "node:fs";
import {
  VALID_DIRECTIVE_CATEGORIES,
  VALID_DIRECTIVE_KINDS,
  VALID_DIRECTIVE_SCOPES,
  isValidCategoryScope,
  validScopesForCategory,
  type DirectiveCategory,
  type DirectiveScope,
} from "#/shared/validator";

export const initCommand = command({
  meta: {
    name: "init",
    description: "Initialize a project and link the current directory as a workspace",
  },
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      positional: true,
      description: "Project name (defaults to current folder name)",
    },
    path: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "p",
      description: "Workspace path (defaults to cwd)",
    },
    description: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "d",
      description: "Project description",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "l",
      description: "Workspace label",
    },
  },
  run: async ({ args, output }) => {
    const rawWsPath = path.resolve(args.path ?? process.cwd());
    const wsPath = normalizeWorkspacePath(rawWsPath);
    const git = await detectGitContext(rawWsPath);
    const projectName = args.name ?? (git ? path.basename(git.gitRoot) : path.basename(rawWsPath));
    const defaultLabel = git?.branch;

    // Check if workspace already exists at this exact path
    const existing = await runEffect(DomainWorkspaces.resolveWorkspace(wsPath));
    if (existing && existing.path === wsPath) {
      const project = await runEffect(DomainProjects.getProject(existing.projectId));
      if (!project) {
        return output.error("not_found", `Project not found for workspace: ${existing.projectId}`);
      }
      if (output.isJson()) {
        output.success({ project, workspace: existing });
      } else {
        output.print(
          `Workspace already registered for project '${project?.name}' (${existing.projectId})`,
        );
        output.print(`Path: ${existing.path}`);
      }
      return;
    }

    const projects = await runEffect(DomainProjects.listProjects());

    // Worktree attachment takes priority over name-match: if this is a linked worktree and
    // --name was not given, attach to the main worktree's project for accurate association.
    let project: (typeof projects)[number] | undefined;

    if (!args.name && git?.mainWorktreePath) {
      const mainNormalized = normalizeWorkspacePath(git.mainWorktreePath);
      const mainWs = await runEffect(DomainWorkspaces.resolveWorkspace(mainNormalized));
      if (mainWs) {
        const mainProject = await runEffect(DomainProjects.getProject(mainWs.projectId));
        if (mainProject) {
          project = mainProject;
        }
      }
    }

    if (!project) {
      project = projects.find((p) => p.name === projectName);
    }

    if (!project) {
      project = await runEffect(
        DomainProjects.createProject({
          name: projectName,
          description: args.description,
        }),
      );
      if (!output.isJson()) {
        output.print(`Created project '${project.name}' (${project.id})`);
      }
    } else {
      if (!output.isJson()) {
        output.print(`Using existing project '${project.name}' (${project.id})`);
      }
    }

    const ws = await runEffect(
      DomainWorkspaces.addWorkspace({
        projectId: project.id,
        path: wsPath,
        label: args.label ?? defaultLabel,
      }),
    );

    if (output.isJson()) {
      output.success({ project, workspace: ws });
    } else {
      output.print(`Linked workspace ${ws.id} -> ${ws.path}`);
    }
  },
});

const listCommand = command({
  meta: { name: "list", description: "List all projects" },
  run: async ({ output }) => {
    const projects = await runEffect(DomainProjects.listProjects());
    if (output.isJson()) {
      output.success({ items: projects });
      return;
    }
    if (projects.length === 0) {
      output.print("No projects found. Run `depot init` to create one.");
      return;
    }
    for (const p of projects) {
      output.print(`${p.id}  ${p.name}  [${p.status}]`);
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show project details" },
  args: {
    projectId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Project ID",
    },
  },
  run: async ({ args, output }) => {
    const project = await runEffect(DomainProjects.getProject(args.projectId));
    if (!project) return output.error("not_found", `Project not found: ${args.projectId}`);
    if (output.isJson()) {
      output.success({ item: project });
    } else {
      output.fields([
        ["ID", project.id],
        ["Name", project.name],
        ["Status", project.status],
        ["Description", project.description],
        ["Created", formatDate(project.createdAt)],
        ["Updated", formatDate(project.updatedAt)],
      ]);
    }
  },
});

const updateCommand = command({
  meta: { name: "update", description: "Update project name, description, or status" },
  args: {
    projectId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Project ID",
    },
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "n",
      description: "New project name",
    },
    description: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "d",
      description: "New project description",
    },
    status: {
      schema: Schema.Literal(...VALID_PROJECT_STATUSES),
      alias: "s",
      description: `New project status (${VALID_PROJECT_STATUSES.join(", ")})`,
    },
  },
  run: async ({ args, output }) => {
    const project = await runEffect(DomainProjects.getProject(args.projectId));
    if (!project) return output.error("not_found", `Project not found: ${args.projectId}`);
    if (!args.name && !args.description && !args.status) {
      return output.error(
        "no_changes",
        "No changes provided. Use --name, --description, or --status.",
      );
    }
    const updated = await runEffect(
      DomainProjects.updateProject(project.id, {
        name: args.name,
        description: args.description,
        status: args.status,
      }),
    );
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Updated project '${updated.name}' (${updated.id}) [${updated.status}]`);
    }
  },
});

const archiveCommand = command({
  meta: { name: "archive", description: "Archive a project (set status to done)" },
  args: {
    projectId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Project ID",
    },
  },
  run: async ({ args, output }) => {
    const project = await runEffect(DomainProjects.getProject(args.projectId));
    if (!project) return output.error("not_found", `Project not found: ${args.projectId}`);
    if (project.status === "done") {
      return output.error("already_done", `Project '${project.name}' is already archived (done).`);
    }
    const updated = await runEffect(DomainProjects.updateProject(project.id, { status: "done" }));
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Archived project '${updated.name}' (${updated.id}) [done]`);
    }
  },
});

type DiagnoseFinding =
  | {
      kind: "prd_workspace_project_mismatch";
      prdRevisionId: string;
      prdTitle: string;
      prdProjectId: string;
      workspaceId: string;
      workspaceProjectId: string;
    }
  | {
      kind: "prd_workspace_missing";
      prdRevisionId: string;
      prdTitle: string;
      workspaceId: string;
    }
  | {
      kind: "task_prd_missing";
      taskId: string;
      taskTitle: string;
      prdRevisionId: string;
    }
  | {
      kind: "review_prd_missing";
      reviewId: string;
      prdRevisionId: string;
    };

const diagnoseCommand = command({
  meta: { name: "diagnose", description: "Detect cross-entity inconsistencies in the database" },
  args: {},
  run: async ({ output }) => {
    const findings = await runEffect(
      Effect.gen(function* () {
        const db = yield* Db;
        const results: DiagnoseFinding[] = [];

        // PRDs with workspaceId — check workspace exists and project matches.
        const prdRevs = yield* dbQuery(() =>
          db.query.prdRevisions.findMany({ where: { workspaceId: { isNotNull: true } } }),
        );
        for (const rev of prdRevs) {
          if (!rev.workspaceId) continue;
          const ws = yield* dbQuery(() =>
            db.query.workspaces.findFirst({ where: { id: rev.workspaceId! } }),
          );
          if (!ws) {
            results.push({
              kind: "prd_workspace_missing",
              prdRevisionId: rev.id,
              prdTitle: rev.title,
              workspaceId: rev.workspaceId,
            });
            continue;
          }
          if (ws.projectId !== rev.projectId) {
            results.push({
              kind: "prd_workspace_project_mismatch",
              prdRevisionId: rev.id,
              prdTitle: rev.title,
              prdProjectId: rev.projectId,
              workspaceId: rev.workspaceId,
              workspaceProjectId: ws.projectId,
            });
          }
        }

        // Tasks pointing at non-existent PRD revisions.
        const allTasks = yield* dbQuery(() => db.query.tasks.findMany());
        for (const t of allTasks) {
          const rev = yield* dbQuery(() =>
            db.query.prdRevisions.findFirst({ where: { id: t.prdRevisionId } }),
          );
          if (!rev) {
            results.push({
              kind: "task_prd_missing",
              taskId: t.id,
              taskTitle: t.title,
              prdRevisionId: t.prdRevisionId,
            });
          }
        }

        // Reviews pointing at non-existent PRD revisions.
        const allReviews = yield* dbQuery(() => db.query.reviews.findMany());
        for (const r of allReviews) {
          const rev = yield* dbQuery(() =>
            db.query.prdRevisions.findFirst({ where: { id: r.prdRevisionId } }),
          );
          if (!rev) {
            results.push({
              kind: "review_prd_missing",
              reviewId: r.id,
              prdRevisionId: r.prdRevisionId,
            });
          }
        }
        return results;
      }),
    );

    if (output.isJson()) {
      output.success({ items: findings, count: findings.length });
    } else {
      if (findings.length === 0) {
        output.print("No cross-entity inconsistencies detected.");
      } else {
        output.print(`Found ${findings.length} cross-entity issue(s):`);
        for (const f of findings) {
          if (f.kind === "prd_workspace_project_mismatch") {
            output.print(
              `  [mismatch] PRD ${f.prdRevisionId} ('${f.prdTitle}') project=${f.prdProjectId} but workspace ${f.workspaceId} is in project=${f.workspaceProjectId}`,
            );
          } else if (f.kind === "prd_workspace_missing") {
            output.print(
              `  [orphan]   PRD ${f.prdRevisionId} ('${f.prdTitle}') references missing workspace ${f.workspaceId}`,
            );
          } else if (f.kind === "task_prd_missing") {
            output.print(
              `  [orphan]   Task ${f.taskId} ('${f.taskTitle}') references missing PRD revision ${f.prdRevisionId}`,
            );
          } else if (f.kind === "review_prd_missing") {
            output.print(
              `  [orphan]   Review ${f.reviewId} references missing PRD revision ${f.prdRevisionId}`,
            );
          }
        }
      }
    }

    if (findings.length > 0) {
      process.exitCode = 2;
    }
  },
});

// ── Project config ────────────────────────────────────────────────────────────

const configSetCommand = command({
  meta: { name: "set", description: "Set a project config key" },
  workspace: true,
  args: {
    key: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Config key",
    },
    value: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Config value",
    },
  },
  run: async ({ args, ws, output }) => {
    if (!DomainProjectConfig.isKnownKey(args.key)) {
      output.print(
        `Warning: '${args.key}' is not a known config key. Setting anyway (forward-compat).`,
      );
    }
    const item = await runEffect(
      DomainProjectConfig.setConfig(ws.projectId, args.key, args.value, "human"),
    );
    if (output.isJson()) output.success({ item });
    else output.print(`Set ${item.key} = ${item.value}`);
  },
});

const configGetCommand = command({
  meta: { name: "get", description: "Read a project config key" },
  workspace: true,
  args: {
    key: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Config key",
    },
  },
  run: async ({ args, ws, output }) => {
    const item = await runEffect(DomainProjectConfig.getConfig(ws.projectId, args.key));
    if (!item) return output.error("not_found", `No config value for key '${args.key}'`);
    if (output.isJson()) output.success({ item });
    else output.print(item.value);
  },
});

const configListCommand = command({
  meta: { name: "list", description: "List all project config" },
  workspace: true,
  args: {},
  run: async ({ ws, output }) => {
    const items = await runEffect(DomainProjectConfig.listConfig(ws.projectId));
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No config values.");
      return;
    }
    for (const c of items) {
      output.print(`${c.key} = ${c.value}  [${c.updatedBySource}]`);
    }
  },
});

const configUnsetCommand = command({
  meta: { name: "unset", description: "Remove a project config key" },
  workspace: true,
  args: {
    key: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Config key",
    },
  },
  run: async ({ args, ws, output }) => {
    await runEffect(DomainProjectConfig.unsetConfig(ws.projectId, args.key));
    if (output.isJson()) output.success({ key: args.key });
    else output.print(`Unset ${args.key}`);
  },
});

const configCommand = command({
  meta: { name: "config", description: "Project configuration" },
  subCommands: {
    set: configSetCommand,
    get: configGetCommand,
    list: configListCommand,
    unset: configUnsetCommand,
  },
});

// ── Project directives ────────────────────────────────────────────────────────

const directiveAddCommand = command({
  meta: { name: "add", description: "Add a project directive" },
  workspace: true,
  args: {
    scope: {
      schema: Schema.Literal(...VALID_DIRECTIVE_SCOPES),
      required: true,
      description: `Directive scope (${VALID_DIRECTIVE_SCOPES.join("|")})`,
    },
    // `category` is intentionally NOT marked required so the framework's
    // generic "is required" message does not preempt the guidance-rich
    // validation we emit ourselves. PRD 0013 Q3 mandates immediate rejection
    // when the flag is missing — that policy lives in the `run` handler.
    category: {
      schema: Schema.String,
      description: `Directive category (${VALID_DIRECTIVE_CATEGORIES.join("|")})`,
    },
    kind: {
      schema: Schema.Literal(...VALID_DIRECTIVE_KINDS),
      required: true,
      description: "Directive kind (command|rule)",
    },
    title: { schema: Schema.String.pipe(Schema.minLength(1)), required: true },
    instruction: { schema: Schema.String.pipe(Schema.minLength(1)), required: true },
    nonBlocking: { schema: Schema.Boolean, type: "boolean", default: false },
    position: { schema: Schema.Int, coerce: "integer" },
    repoTarget: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Repo target for command directives (auto|all|workspace|<repo-name>)",
    },
  },
  run: async ({ args, ws, output }) => {
    const category = requireDirectiveCategory(args.category, args.scope, output);
    const item = await runEffect(
      DomainDirectives.createDirective({
        projectId: ws.projectId,
        scope: args.scope,
        category,
        kind: args.kind,
        title: args.title,
        instruction: args.instruction,
        blocking: !args.nonBlocking,
        position: args.position,
        repoTarget: args.repoTarget,
      }),
    );
    if (output.isJson()) output.success({ item });
    else
      output.print(
        `Created directive ${item.id} (${item.category}/${item.scope}) — '${item.title}'`,
      );
  },
});

/**
 * Resolve the `--category` flag and validate `(category, scope)` against the
 * authoritative table in `validator.ts`. On any failure, terminates the
 * process via `output.error` with a guidance message that lists either the
 * allowed categories or the valid scopes for the user's category.
 *
 * Per PRD 0013 Q3 the rejection is immediate — no inference from `scope`, no
 * deprecation grace window.
 */
function requireDirectiveCategory(
  rawCategory: string | undefined,
  scope: DirectiveScope,
  output: CommandOutput,
): DirectiveCategory {
  const list = VALID_DIRECTIVE_CATEGORIES.join(", ");
  // Treat an empty string the same as a missing flag — the schema is
  // `Schema.String` (not Literal) so `--category ""` would otherwise fall
  // through to the "unknown value" branch and lose the guidance-rich message
  // PRD 0013 Q3 mandates for the absent-flag case.
  if (rawCategory === undefined || rawCategory === "") {
    output.error(
      "category_required",
      `depot project directive add requires --category <cat>. ` +
        `Each directive must be filed under exactly one of: ${list}. ` +
        `Example: depot project directive add --category coder --scope pre-commit ` +
        `--kind rule --title "Run formatter" --instruction "format before committing". ` +
        `See docs/concepts/index.md for the (category, scope) compatibility table.`,
    );
  }
  if (!(VALID_DIRECTIVE_CATEGORIES as readonly string[]).includes(rawCategory)) {
    output.error(
      "category_invalid",
      `--category received unknown value '${rawCategory}'. ` + `Allowed categories: ${list}.`,
    );
  }
  const category = rawCategory as DirectiveCategory;
  if (!isValidCategoryScope(category, scope)) {
    const validScopes = validScopesForCategory(category);
    const scopeList = validScopes.length > 0 ? validScopes.join(", ") : "(none)";
    output.error(
      "category_scope_invalid",
      `Invalid (category, scope) combination: (${category}, ${scope}). ` +
        `Valid scopes for category '${category}': ${scopeList}. ` +
        `See docs/concepts/index.md for the full compatibility table.`,
    );
  }
  return category;
}

const directiveListCommand = command({
  meta: { name: "list", description: "List project directives" },
  workspace: true,
  args: {
    scope: { schema: Schema.Literal(...VALID_DIRECTIVE_SCOPES) },
    category: {
      schema: Schema.Literal(...VALID_DIRECTIVE_CATEGORIES),
      description: `Filter by directive category (${VALID_DIRECTIVE_CATEGORIES.join("|")})`,
    },
    enabledOnly: { schema: Schema.Boolean, type: "boolean", default: false },
  },
  run: async ({ args, ws, output }) => {
    const items = await runEffect(
      DomainDirectives.listDirectives(ws.projectId, {
        scope: args.scope,
        category: args.category,
        enabledOnly: args.enabledOnly,
      }),
    );
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No directives.");
      return;
    }
    for (const d of items) {
      const flags = `${d.enabled ? "enabled" : "disabled"}${d.blocking ? "" : ", non-blocking"}`;
      // `d.category` is nullable in SQLite (cannot retro-fit NOT NULL via ALTER
      // TABLE); legacy rows that escaped the backfill render as `?` so the
      // integrity issue is visible instead of producing a literal "null".
      const category = d.category ?? "?";
      output.print(
        `${d.id}  [${category}/${d.scope}] #${d.position}  ${d.title}  (${d.kind}, ${flags})`,
      );
    }
  },
});

const directiveShowCommand = command({
  meta: { name: "show", description: "Show a directive" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Directive ID",
    },
  },
  run: async ({ args, output }) => {
    const item = await runEffect(DomainDirectives.getDirective(args.id));
    if (!item) return output.error("not_found", `Directive not found: ${args.id}`);
    if (output.isJson()) output.success({ item });
    else {
      output.fields([
        ["ID", item.id],
        ["Category", item.category],
        ["Scope", item.scope],
        ["Kind", item.kind],
        ["Repo target", item.repoTarget],
        ["Title", item.title],
        ["Instruction", item.instruction],
        ["Blocking", item.blocking],
        ["Enabled", item.enabled],
        ["Position", item.position],
        ["Last run", item.lastRunAt?.toISOString() ?? null],
        ["Last status", item.lastRunStatus],
      ]);
    }
  },
});

const directiveRunCommand = command({
  meta: { name: "run", description: "Execute a directive (kind=command only)" },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Directive ID",
    },
  },
  run: async ({ args, ws, output }) => {
    const result = await runEffect(
      DomainDirectives.runDirective(args.id, { wsPath: ws.path, source: "human" }),
    );
    if (output.isJson()) output.success(result);
    else {
      output.print(
        `Directive ${args.id} ${result.ok ? "OK" : "FAILED"} in ${result.durationMs}ms (exit=${result.exitCode})`,
      );
      const trace = DomainDirectives.formatSelectionTrace(result.selection);
      if (trace) output.print(trace);
      if (result.stdout) output.print(`-- stdout --\n${result.stdout}`);
      if (result.stderr) output.print(`-- stderr --\n${result.stderr}`);
    }
    if (!result.ok) process.exitCode = result.exitCode || 1;
  },
});

const directiveRemoveCommand = command({
  meta: { name: "remove", description: "Remove a directive" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Directive ID",
    },
  },
  run: async ({ args, output }) => {
    await runEffect(DomainDirectives.removeDirective(args.id));
    if (output.isJson()) output.success({ id: args.id });
    else output.print(`Removed directive ${args.id}`);
  },
});

const directiveEnableCommand = command({
  meta: { name: "enable", description: "Enable a directive" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Directive ID",
    },
  },
  run: async ({ args, output }) => {
    const item = await runEffect(DomainDirectives.updateDirective(args.id, { enabled: true }));
    if (output.isJson()) output.success({ item });
    else output.print(`Enabled directive ${args.id}`);
  },
});

const directiveDisableCommand = command({
  meta: { name: "disable", description: "Disable a directive" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Directive ID",
    },
  },
  run: async ({ args, output }) => {
    const item = await runEffect(DomainDirectives.updateDirective(args.id, { enabled: false }));
    if (output.isJson()) output.success({ item });
    else output.print(`Disabled directive ${args.id}`);
  },
});

const directiveReorderCommand = command({
  meta: { name: "reorder", description: "Reorder directives within a scope" },
  workspace: true,
  args: {
    scope: {
      schema: Schema.Literal(...VALID_DIRECTIVE_SCOPES),
      required: true,
      description: "Scope to reorder",
    },
    ids: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Comma-separated directive IDs in the desired order",
    },
  },
  run: async ({ args, ws, output }) => {
    const orderedIds = args.ids
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const result = await runEffect(
      DomainDirectives.reorderDirectives(ws.projectId, args.scope as DirectiveScope, orderedIds),
    );
    if (output.isJson()) output.success(result);
    else output.print(`Reordered ${result.count} directive(s) in scope '${result.scope}'`);
  },
});

const directiveCommand = command({
  meta: { name: "directive", description: "Project directive management" },
  subCommands: {
    add: directiveAddCommand,
    list: directiveListCommand,
    show: directiveShowCommand,
    run: directiveRunCommand,
    remove: directiveRemoveCommand,
    enable: directiveEnableCommand,
    disable: directiveDisableCommand,
    reorder: directiveReorderCommand,
  },
});

// ── Project repos ─────────────────────────────────────────────────────────────

const repoAddCommand = command({
  meta: { name: "add", description: "Register a git repo for the project" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Repo name (unique per project, e.g. front, api, common)",
    },
    path: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Path to the repo (absolute or relative to the workspace)",
    },
    primary: { schema: Schema.Boolean, type: "boolean", default: false },
    baseBranch: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Base branch for this repo (default: main)",
    },
  },
  run: async ({ args, ws, output }) => {
    const resolvedPath = path.isAbsolute(args.path) ? args.path : path.resolve(ws.path, args.path);
    if (!existsSync(resolvedPath)) {
      return output.error("not_found", `Path does not exist: ${resolvedPath}`);
    }
    if (!existsSync(path.join(resolvedPath, ".git"))) {
      return output.error("not_a_repo", `Path is not a git repo (no .git): ${resolvedPath}`);
    }
    const item = await runEffect(
      DomainRepos.addRepo({
        projectId: ws.projectId,
        name: args.name,
        path: resolvedPath,
        isPrimary: args.primary,
        baseBranch: args.baseBranch,
      }),
    );
    if (output.isJson()) output.success({ item });
    else
      output.print(
        `Registered repo '${item.name}' -> ${item.path} (base ${item.baseBranch}${item.isPrimary ? ", primary" : ""})`,
      );
  },
});

const repoListCommand = command({
  meta: { name: "list", description: "List the project's registered repos" },
  workspace: true,
  args: {},
  run: async ({ ws, output }) => {
    const repos = await runEffect(DomainRepos.listRepos(ws.projectId));
    if (repos.length === 0) {
      const resolved = await runEffect(DomainRepos.resolveProjectRepos(ws.projectId, ws.path));
      if (output.isJson()) {
        output.success({ items: resolved, implicit: true });
        return;
      }
      const implicit = resolved[0]!;
      output.print(`${implicit.name}  ${implicit.path}  (base ${implicit.baseBranch})`);
      output.print("implicit — add repos to enable multi-repo");
      return;
    }
    if (output.isJson()) {
      output.success({ items: repos });
      return;
    }
    for (const r of repos) {
      output.print(
        `${r.id}  ${r.name}  ${r.path}  (base ${r.baseBranch}${r.isPrimary ? ", primary" : ""})`,
      );
    }
  },
});

const repoRemoveCommand = command({
  meta: { name: "remove", description: "Remove a registered repo" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Repo name",
    },
  },
  run: async ({ args, ws, output }) => {
    const repo = await runEffect(DomainRepos.getRepo(ws.projectId, args.name));
    if (!repo) return output.error("not_found", `Repo not found: ${args.name}`);
    await runEffect(DomainRepos.removeRepo(repo.id));
    if (output.isJson()) output.success({ id: repo.id, name: repo.name });
    else output.print(`Removed repo '${repo.name}'`);
  },
});

const repoSetCommand = command({
  meta: { name: "set", description: "Update a registered repo's base branch" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Repo name",
    },
    baseBranch: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "New base branch",
    },
    primary: { schema: Schema.Boolean, type: "boolean" },
  },
  run: async ({ args, ws, output }) => {
    const repo = await runEffect(DomainRepos.getRepo(ws.projectId, args.name));
    if (!repo) return output.error("not_found", `Repo not found: ${args.name}`);
    if (args.baseBranch === undefined && args.primary === undefined) {
      return output.error("no_changes", "No changes provided. Use --base-branch or --primary.");
    }
    const item = await runEffect(
      DomainRepos.updateRepo(repo.id, {
        baseBranch: args.baseBranch,
        isPrimary: args.primary,
      }),
    );
    if (output.isJson()) output.success({ item });
    else
      output.print(
        `Updated repo '${item.name}' (base ${item.baseBranch}${item.isPrimary ? ", primary" : ""})`,
      );
  },
});

const repoCommand = command({
  meta: { name: "repo", description: "Project git repo registry" },
  subCommands: {
    add: repoAddCommand,
    list: repoListCommand,
    remove: repoRemoveCommand,
    set: repoSetCommand,
  },
});

export const projectCommand = command({
  meta: { name: "project", description: "Project management" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    update: updateCommand,
    archive: archiveCommand,
    diagnose: diagnoseCommand,
    config: configCommand,
    directive: directiveCommand,
    repo: repoCommand,
  },
});
