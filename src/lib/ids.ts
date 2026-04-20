import { ulid } from "ulid";

export function generateId(): string {
  return ulid();
}

/**
 * Return the first 8 characters of a ULID for display purposes.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
