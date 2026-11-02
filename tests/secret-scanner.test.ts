import { findSecretKinds, redactSecretMaterial } from '../lib/secret-scanner';

describe('secret material scanner', () => {
  it('detects common provider, cloud, source-control, and credential formats', () => {
    const source = [
      'const openai = "' + ('sk-proj-' + 'abcdefghijklmnopqrstuvwxyz0123456789') + '";',
      'const groq = "' + ('gsk_' + 'abcdefghijklmnopqrstuvwxyz0123456789') + '";',
      'const aws = "' + ('AKIA' + '1234567890ABCDEF') + '";',
      'const github = "' + ('github_pat_' + 'abcdefghijklmnopqrstuvwxyz0123456789') + '";',
      'const stripe = "' + ('sk_live_' + 'abcdefghijklmnop123456') + '";',
      'const google = "' + ('AIza' + '12345678901234567890123456789012345') + '";',
      'const bearer = "' + ('Bearer ' + 'abcdefghijklmnopqrstuvwxyz012345') + '";',
      'const password = "' + ('a-very-long-' + 'private-password-value') + '";',
    ].join('\\n');
    expect(findSecretKinds(source)).toEqual(expect.arrayContaining([
      'openai-key', 'groq-key', 'aws-access-key', 'github-token',
      'stripe-key', 'google-api-key', 'bearer-token', 'credential-assignment',
    ]));
  });

  it('detects PEM private keys and JWT-like values', () => {
    const pem = '-----BEGIN ' + 'PRIVATE KEY-----\\n' +
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\n' +
      '-----END ' + 'PRIVATE KEY-----';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepayloadvalue';
    expect(findSecretKinds(pem + '\\nconst jwt = "' + jwt + '";'))
      .toEqual(expect.arrayContaining(['private-key', 'jwt']));
  });

  it('redacts matched material without preserving the token value', () => {
    const token = 'sk-proj-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactSecretMaterial('OPENAI_API_KEY="' + token + '"');
    expect(redacted).not.toContain(token);
    expect(redacted).toContain('[REDACTED:');
  });

  it('does not flag environment variable references or obvious placeholders', () => {
    const source = [
      'const key = process.env.OPENAI_API_KEY;',
      'const token = "YOUR_API_KEY_HERE";',
      'const password = "changeme";',
    ].join('\\n');
    expect(findSecretKinds(source)).toEqual([]);
  });
});
