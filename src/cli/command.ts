import { defineCommand } from "citty";
import type { ArgsDef, CommandContext, CommandDef } from "citty";
import type { ZodType } from "zod";
import { validateArgs } from "#/lib/schemas";

type ValidatedCommandContext<TParsedArgs, TArgsDef extends ArgsDef> = Omit<CommandContext<TArgsDef>, "args"> & {
  args: TParsedArgs;
};

type ValidatedCommandDef<TArgsDef extends ArgsDef, TParsedArgs> = Omit<CommandDef<TArgsDef>, "setup" | "run"> & {
  schema: ZodType<TParsedArgs>;
  setup?: (ctx: ValidatedCommandContext<TParsedArgs, TArgsDef>) => unknown;
  run?: (ctx: ValidatedCommandContext<TParsedArgs, TArgsDef>) => unknown;
};

export function defineValidatedCommand<TArgsDef extends ArgsDef, TParsedArgs>(
  config: ValidatedCommandDef<TArgsDef, TParsedArgs>,
) {
  const { schema, setup, run, ...command } = config;

  return defineCommand({
    ...command,
    setup(ctx) {
      const args = validateArgs(schema, ctx.args);
      return setup?.({ ...ctx, args });
    },
    run(ctx) {
      const args = validateArgs(schema, ctx.args);
      return run?.({ ...ctx, args });
    },
  });
}
