import { findSecretKinds, redactSecretMaterial } from '../lib/secret-scanner';

describe('secret material scanner', () => {
  it('detects common provider, cloud, source-control, and credential formats', () => {
    const source = [
      'const openai = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";',
      'const groq = "gsk_abcdefghijklmnopqrstuvwxyz0123456789";',
      'const aws = "AKIA1234567890ABCDEF";',
      'const github = "github_pat_abcdefghijklmnopqrstuvwxyz0123456789";',
      'const stripe = "sk_live_abcdefghijklmnop123456";',
      'const google = "AIza12345678901234567890123456789012345";',
      'const bearer = "Bearer abcdefghijklmnopqrstuvwxyz012345";',
      'const password = "a-very-long-private-password-value";',
      'const aws_secret_access_key = "long-aws-secret-access-value";',
    ].join('\n');

    expect(findSecretKinds(source)).toEqual(expect.arrayContaining([
      'openai-key', 'groq-key', 'aws-access-key', 'github-token',
      'stripe-key', 'google-api-key', 'bearer-token', 'credential-assignment',
    ]));
  });

  it('detects PEM private keys and JWT-like values', () => {
    const source = [
      '-----BEGIN PRIVATE KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
      '-----END PRIVATE KEY-----',
      'const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepayloadvalue";',
    ].join('\n');
    expect(findSecretKinds(source)).toEqual(expect.arrayContaining(['private-key', 'jwt']));
  });

  it('redacts matched material without preserving the token value', () => {
    const token = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactSecretMaterial('OPENAI_API_KEY="' + token + '"');
    expect(redacted).not.toContain(token);
    expect(redacted).toContain('[REDACTED:');
  });

  it('does not flag environment variable references or obvious placeholders', () => {
    const source = [
      'const key = process.env.OPENAI_API_KEY;',
      'const token = "YOUR_API_KEY_HERE";',
      'const password = "changeme";',
    ].join('\n');
    expect(findSecretKinds(source)).toEqual([]);
  });
});

  it('detects unquoted assignments and database connection strings', () => {
    const source = [
      'API_KEY=abcdefghijklmnopqrstuvwxyz0123456789',
      'password: abcdefghijklmnopqrstuvwxyz0123456789',
      'DATABASE_URL=postgres://app:super-secret-password@db.example.test:5432/app',
      'const npm = "npm_abcdefghijklmnopqrstuvwxyz1234567890";',
      'const sendgrid = "SG.abcdefghijklmnop.abcdefghijklmnop";',
    ].join('\\n');
    expect(findSecretKinds(source)).toEqual(expect.arrayContaining([
      'credential-assignment', 'database-url', 'npm-token', 'sendgrid-token',
    ]));
  });

  it('redacts unquoted credentials and connection strings', () => {
    const source = 'API_KEY=abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactSecretMaterial(source);
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(redacted).toContain('[REDACTED:credential-assignment]');
  });
