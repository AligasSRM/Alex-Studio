const PROTECTED_AI_PATH = /(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?)(\/|$)/i;

/** Paths that AI-generated drafts must never create, modify, or apply. */
export function isProtectedAIGeneratedPath(filePath: string): boolean {
  return PROTECTED_AI_PATH.test(filePath.replace(/\\/g, '/'));
}
