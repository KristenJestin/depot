import { Command } from "@commander-js/extra-typings";

const program = new Command()
  .name("xxx")
  .description("xxxx")
  .version("1.0.0");

program.parseAsync(process.argv);
