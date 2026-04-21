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

/**
 * Return the shortest display prefix that is unique within the provided IDs.
 */
export function uniqueIdPrefix(id: string, allIds: string[], minLength = 8): string {
  for (let length = minLength; length <= id.length; length++) {
    const prefix = id.slice(0, length);
    const collisions = allIds.filter((candidate) => candidate.startsWith(prefix));
    if (collisions.length === 1) {
      return prefix;
    }
  }

  return id;
}
