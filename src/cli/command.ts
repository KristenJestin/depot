import { defineCommand, type ArgsDef, type CommandContext, type CommandDef } from "citty";
import { Schema } from "effect";
import { outputError, outputSuccess, isJsonMode } from "#/cli/output";
import { resolveCurrentWorkspace } from "#/cli/runtime";
import { log } from "#/shared/logger";

// ── Arg definition ────────────────────────────────────────────────────────────

type ValidatedArgInput = {
  /** Effect/Schema used to validate this arg. any is required for generic ParsedArgs inference. */
  schema: Schema.Schema<any, any, never>;
  /**
   * Whether this arg is required. Defaults to false.
   * - true: always validated; exits with error if missing or invalid
   * - false/omitted: skipped if absent; validated if present
   */
  required?: boolean;
  /** Explicit citty type. Defaults to "string". Use "boolean" for flags. */
  type?: "boolean" | "string";
  /** Coerce parser strings into a typed value before schema validation. */
  coerce?: "integer";
  /** User-facing shape used when validation fails. */
  expected?: string;
  /** Default value forwarded to citty (and used when the flag is absent). */
  default?: unknown;
  /** Set to true for positional (non-flag) args. */
  positional?: true;
  description?: string;
  alias?: string | string[];
};

type ValidatedArgsDef = Record<string, ValidatedArgInput>;

// ── Output helpers ────────────────────────────────────────────────────────────

export type CommandOutput = {
  /** Emit a structured error and exit. Works in both JSON and text mode. */
  error: (code: string, message: string) => never;
  /** Emit a JSON success envelope to stdout. Always writes; guard with isJson() in text mode. */
  success: <T>(payload: T) => void;
  /** Returns true when the CLI is running in --json mode. */
  isJson: () => boolean;
  /** Write to stdout (text-mode output). */
  print: (...args: unknown[]) => void;
  /** Print aligned key-value pairs to stdout. Null/undefined values are skipped. */
  fields: (entries: [string, unknown][]) => void;
};

const sharedOutput: CommandOutput = {
  error: outputError,
  success: outputSuccess,
  isJson: isJsonMode,
  print: (...args) => log.info(...args),
  fields: (entries) => log.fields(entries),
};

// ── Workspace ─────────────────────────────────────────────────────────────────

export type WorkspaceConfig = true | { autoCreate?: boolean };
type WorkspaceResult = Awaited<ReturnType<typeof resolveCurrentWorkspace>>;

type InferWorkspaceContext<W> = W extends WorkspaceConfig ? WorkspaceResult : Record<never, never>;

// ── Type inference ────────────────────────────────────────────────────────────

/**
 * An arg is always-defined (type T, not T | undefined) when:
 * - required: true is set, OR
 * - a default value is provided ({ default: {} } matches any non-null/non-undefined value)
 */
type IsDefinedArg<TArg> = TArg extends { required: true }
  ? true
  : TArg extends { default: {} }
    ? true
    : false;

type ParsedArgs<TDef extends ValidatedArgsDef> = {
  [K in keyof TDef]: TDef[K] extends { schema: Schema.Schema<infer A, any, any> }
    ? IsDefinedArg<TDef[K]> extends true
      ? A
      : A | undefined
    : never;
};

export type ValidatedCommandContext<T, W extends WorkspaceConfig | undefined = undefined> = Omit<
  CommandContext<any>,
  "args"
> & { args: T; output: CommandOutput } & InferWorkspaceContext<W>;

// ── Command definition type ───────────────────────────────────────────────────

type CommandConfig<
  TDef extends ValidatedArgsDef,
  W extends WorkspaceConfig | undefined = undefined,
> = Omit<CommandDef<any>, "setup" | "run" | "args"> & {
  workspace?: W;
  args?: TDef;
  setup?: (ctx: ValidatedCommandContext<ParsedArgs<TDef>, W>) => unknown;
  run?: (ctx: ValidatedCommandContext<ParsedArgs<TDef>, W>) => unknown;
};

// ── Arg parsing ───────────────────────────────────────────────────────────────

type CoercionResult = { ok: true; value: unknown } | { ok: false; message: string };

function coerceArgValue(key: string, def: ValidatedArgInput, value: unknown): CoercionResult {
  if (def.coerce !== "integer") {
    return { ok: true, value };
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return { ok: true, value };
  }

  if (typeof value === "string") {
    const raw = value.startsWith("=") ? value.slice(1) : value;
    const trimmed = raw.trim();
    if (/^[+-]?\d+$/.test(trimmed)) {
      return { ok: true, value: Number.parseInt(trimmed, 10) };
    }
  }

  return {
    ok: false,
    message: formatValidationMessage(key, def, value),
  };
}

function formatValidationMessage(key: string, def: ValidatedArgInput, value: unknown): string {
  const expected = def.expected ?? "a valid value";
  return `${formatFlagName(key)} must be ${expected}; got ${formatReceivedValue(value)}`;
}

function formatFlagName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function formatReceivedValue(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value);
}

function parseValidatedArgs<TDef extends ValidatedArgsDef>(
  argsDef: TDef,
  rawArgs: Record<string, unknown>,
): ParsedArgs<TDef> {
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, def] of Object.entries(argsDef)) {
    const rawValue = rawArgs[key];
    const value = rawValue === undefined && def.default !== undefined ? def.default : rawValue;

    if (def.required === true && value === undefined) {
      errors.push(`${formatFlagName(key)} is required`);
      continue;
    }

    if (value !== undefined) {
      const coerced = coerceArgValue(key, def, value);
      if (!coerced.ok) {
        errors.push(coerced.message);
        continue;
      }

      try {
        result[key] = Schema.decodeUnknownSync(def.schema)(coerced.value);
      } catch {
        errors.push(formatValidationMessage(key, def, value));
      }
    } else {
      result[key] = undefined;
    }
  }

  if (errors.length > 0) {
    const message = errors.join("; ");
    if (isJsonMode()) {
      process.stdout.write(
        JSON.stringify({ kind: "error", error: { code: "validation_error", message } }) + "\n",
      );
    } else {
      console.error(`Validation error: ${message}`);
    }
    process.exit(1);
  }

  return result as ParsedArgs<TDef>;
}

// ── command ───────────────────────────────────────────────────────────────────

export function command<
  TDef extends ValidatedArgsDef,
  W extends WorkspaceConfig | undefined = undefined,
>(config: CommandConfig<TDef, W>): CommandDef<any> {
  const { args: argsDef, setup, run, workspace: workspaceConfig, ...rest } = config;

  const cittyArgs: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(argsDef ?? {})) {
    const cittyType = def.positional ? "positional" : (def.type ?? "string");
    cittyArgs[key] = {
      type: cittyType,
      description: def.description,
      ...(def.alias !== undefined ? { alias: def.alias } : {}),
      ...(def.default !== undefined ? { default: def.default } : {}),
      ...(def.required === true ? { required: true } : def.positional ? { required: false } : {}),
    };
  }

  function buildCtx(
    ctx: CommandContext<any>,
    args: ParsedArgs<TDef>,
    workspace?: WorkspaceResult,
  ): ValidatedCommandContext<ParsedArgs<TDef>, W> {
    return {
      rawArgs: ctx.rawArgs,
      cmd: ctx.cmd,
      subCommand: ctx.subCommand,
      data: ctx.data,
      args,
      output: sharedOutput,
      ...(workspace ?? {}),
    } as unknown as ValidatedCommandContext<ParsedArgs<TDef>, W>;
  }

  return defineCommand({
    ...rest,
    args: cittyArgs as ArgsDef,
    setup: async (ctx) => {
      ctx.data ??= {};
      ctx.data["_args"] = parseValidatedArgs(
        argsDef ?? ({} as TDef),
        ctx.args as Record<string, unknown>,
      );
      if (workspaceConfig !== undefined) {
        const wsOptions = workspaceConfig === true ? {} : workspaceConfig;
        ctx.data["_workspace"] = await resolveCurrentWorkspace(wsOptions);
      }
      return setup?.(
        buildCtx(
          ctx,
          ctx.data["_args"] as ParsedArgs<TDef>,
          ctx.data["_workspace"] as WorkspaceResult | undefined,
        ),
      );
    },
    run: async (ctx) => {
      ctx.data ??= {};
      const args =
        (ctx.data["_args"] as ParsedArgs<TDef> | undefined) ??
        parseValidatedArgs(argsDef ?? ({} as TDef), ctx.args as Record<string, unknown>);
      // Resolve workspace if setup was skipped
      if (workspaceConfig !== undefined && !("_workspace" in ctx.data)) {
        const wsOptions = workspaceConfig === true ? {} : workspaceConfig;
        ctx.data["_workspace"] = await resolveCurrentWorkspace(wsOptions);
      }
      return run?.(buildCtx(ctx, args, ctx.data["_workspace"] as WorkspaceResult | undefined));
    },
  });
}
