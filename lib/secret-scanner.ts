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
  { kind: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { kind: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { kind: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: 'groq-key', pattern: /\bgsk_[A-Za-z0-9_-]{20,}\b/ },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { kind: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i },
  { kind: 'credential-assignment', pattern: /\b(?:api[_-]?key|(?:client[_-]?)?secret|access[_-]?token|auth[_-]?token|token|password|passwd)\b\s*[:=]\s*["'\x60]([^"'\x60\r\n]{16,})["'\x60]/i },
];

const PLACEHOLDER_VALUE = /^(?:your[_ -]?(?:api[_ -]?)?key[_ -]?here|placeholder|example|dummy|changeme|change[_ -]?me|test|redacted|replace[_ -]?me)$/i;

export function findSecretKinds(value: string): SecretKind[] {
  const found: SecretKind[] = [];
  for (const { kind, pattern } of PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags + 'g');
    let match: RegExpExecArray | null;
    let detected = false;
    while ((match = globalPattern.exec(value)) !== null) {
      if (kind === 'credential-assignment' && PLACEHOLDER_VALUE.test((match[1] || '').trim())) continue;
      detected = true;
      break;
    }
    if (detected) found.push(kind);
  }
  return found;
}

/** Redact secret-like values without returning or logging the matched material. */
export function redactSecretMaterial(value: string): string {
  let redacted = value;
  for (const { kind, pattern } of PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags + 'g');
    redacted = redacted.replace(globalPattern, (matched, credentialValue: string | undefined) => {
      if (kind === 'credential-assignment' && PLACEHOLDER_VALUE.test((credentialValue || '').trim())) return matched;
      return '[REDACTED:' + kind + ']';
    });
  }
  return redacted;
}
