import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error('Usage: node scripts/scan-source-archive-secrets.mjs <extracted-archive-directory>');
  process.exit(2);
}

const patterns = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\\s\\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
  /\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b/,
  /\\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b/,
  /\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b/,
  /\\bAIza[0-9A-Za-z_-]{35}\\b/,
  /\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\\b/,
  /\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b/,
  /\\bgsk_[A-Za-z0-9_-]{20,}\\b/,
  /\\bnpm_[A-Za-z0-9]{30,}\\b/,
  /\\bSG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b/,
  /\\bSK[0-9a-fA-F]{32}\\b/,
  /\\b[A-Za-z0-9_-]{24}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{25,}\\b/,
  /\\b[0-9]{6,12}:[A-Za-z0-9_-]{30,}\\b/,
  /\\b(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?):\\/\\/[^\\s:@/]+:[^\\s@/]+@[^\\s]+/i,
  /\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b/,
  /\\bBearer\\s+[A-Za-z0-9._~+/-]{20,}/i,
  /\\b(?:api[_-]?key|aws[_-]?secret[_-]?access[_-]?key|(?:client[_-]?)?secret|access[_-]?token|auth[_-]?token|token|password|passwd|private[_-]?key|connection[_-]?string)\\b\\s*[:=]\\s*(?:"([^"\\r\\n]{16,})"|'([^'\\r\\n]{16,})'|`([^`\\r\\n]{16,})`|([A-Za-z0-9_./+=:-]{20,}))/i,
];
const placeholder = /^(?:your[_ -]?(?:api[_ -]?)?key[_ -]?here|placeholder|example|dummy|changeme|change[_ -]?me|test|redacted|replace[_ -]?me|not[_ -]?a[_ -]?secret|sample[_ -]?value|process\\.env\\.[A-Z0-9_]+|env\\.[A-Z0-9_]+|\\$\\{?[A-Z_][A-Z0-9_]*\\}?)$/i;

function looksSensitive(content) {
  return patterns.some((pattern) => {
    const match = pattern.exec(content);
    if (!match) return false;
    if (pattern === patterns[patterns.length - 1]) {
      const value = match.slice(1).find((item) => typeof item === 'string') || '';
      return !placeholder.test(value.trim());
    }
    return true;
  });
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      console.error('Refusing source archive: symbolic link encountered at ' + fullPath);
      process.exit(1);
    }
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      console.error('Refusing source archive: unsupported filesystem entry at ' + fullPath);
      process.exit(1);
    }
    const relative = path.relative(root, fullPath).split(path.sep).join('/');
    const bytes = fs.readFileSync(fullPath);
    const content = bytes.toString('latin1').replace(/\\0/g, '');
    if (looksSensitive(content)) {
      console.error('Refusing source archive: secret-like material detected in ' + relative);
      process.exit(1);
    }
  }
}

walk(root);
console.log('Source archive content scan passed.');
