export type SecretKind =
  | 'private-key'
  | 'aws-access-key'
  | 'github-token'
  | 'slack-token'
  | 'google-api-key'
  | 'stripe-key'
  | 'openai-key'
  | 'groq-key'
  | 'jwt'
  | 'bearer-token'
  | 'credential-assignment';

const PATTERNS: Array<{ kind: SecretKind; pattern: RegExp }> = [
  { kind: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'groq-key', pattern: /\bgsk_[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/gi },
  { kind: 'credential-assignment', pattern: /\b(?:api[_-]?key|(?:client[_-]?)?secret|access[_-]?token|auth[_-]?token|token|password|passwd)\b\s*[:=]\s*["'\x60][^"'\x60\r\n]{16,}["'\x60]/gi },
];

export function findSecretKinds(value: string): SecretKind[] {
  const found = new Set<SecretKind>();
  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    if (value.match(pattern)) found.add(kind);
  }
  return [...found];
}

/** Redact secret-like values without returning or logging the matched material. */
export function redactSecretMaterial(value: string): string {
  let redacted = value;
  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[REDACTED:' + kind + ']');
  }
  return redacted;
}
