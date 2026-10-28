import { issueVerificationProof, verifyVerificationProof } from '../lib/ai-verification-proof';

const files = [{ path: 'index.html', content: '<h1>Verified</h1>', baseHash: null }];

describe('server-signed AI verification proof', () => {
  it('accepts a proof for the exact project and verified draft', () => {
    const proof = issueVerificationProof('project-1', files);
    expect(proof).toEqual(expect.any(String));
    expect(verifyVerificationProof('project-1', files, proof)).toBe(true);
  });

  it('rejects a proof for a different project or modified draft', () => {
    const proof = issueVerificationProof('project-1', files);
    expect(verifyVerificationProof('project-2', files, proof)).toBe(false);
    expect(verifyVerificationProof('project-1', [{ ...files[0], content: '<h1>Changed</h1>' }], proof)).toBe(false);
  });

  it('rejects absent, malformed, and expired proofs', () => {
    expect(verifyVerificationProof('project-1', files, null)).toBe(false);
    expect(verifyVerificationProof('project-1', files, 'bad.token')).toBe(false);
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const proof = issueVerificationProof('project-1', files);
    jest.setSystemTime(new Date('2030-01-01T00:11:00.000Z'));
    expect(verifyVerificationProof('project-1', files, proof)).toBe(false);
    jest.useRealTimers();
  });

  it('rejects duplicate paths and malformed file batches', () => {
    expect(issueVerificationProof('project-1', [
      files[0], files[0],
    ])).toBeNull();
    expect(issueVerificationProof('project-1', [])).toBeNull();
  });
});
