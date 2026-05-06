import { readFile } from "node:fs/promises";
import type { CommandOutput } from "#/cli/command";

type ResolveTextInputOptions = {
  output: CommandOutput;
  value: string | undefined;
  file: string | undefined;
  valueFlag: string;
  fileFlag: string;
  required?: boolean;
  expected?: string;
};

export async function resolveTextInput(
  options: ResolveTextInputOptions & { required: true },
): Promise<string>;
export async function resolveTextInput(
  options: ResolveTextInputOptions,
): Promise<string | undefined>;
export async function resolveTextInput({
  output,
  value,
  file,
  valueFlag,
  fileFlag,
  required = false,
  expected = "non-empty text",
}: ResolveTextInputOptions): Promise<string | undefined> {
  if (value !== undefined && file !== undefined) {
    return output.error(
      "conflicting_input",
      `Provide either ${valueFlag} or ${fileFlag}, not both.`,
    );
  }

  if (file !== undefined) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch (e) {
      return output.error(
        "file_read_error",
        `Cannot read file '${file}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (required && content.trim().length === 0) {
      return output.error("validation_error", `${fileFlag} must be ${expected}; got ""`);
    }
    return content;
  }

  if (required && value === undefined) {
    return output.error("validation_error", `${valueFlag} or ${fileFlag} is required`);
  }

  if (required && value !== undefined && value.length === 0) {
    return output.error("validation_error", `${valueFlag} must be ${expected}; got ""`);
  }

  return value;
}
