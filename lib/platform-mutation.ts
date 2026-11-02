export const WINDOWS_MUTATION_UNAVAILABLE = 'UNAVAILABLE: secure Windows-native handle-based file mutation is not implemented; refusing writes, deletes, and project creation until reparse-point and TOCTOU protections are verified.';

export function isMutationUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('UNAVAILABLE:');
}

export function assertWindowsMutationAvailable(): never {
  throw new Error(WINDOWS_MUTATION_UNAVAILABLE);
}
