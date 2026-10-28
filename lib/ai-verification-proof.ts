import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type DraftFile = { path: string; content: string; baseHash: string | null };

// A process-local secret intentionally invalidates outstanding approvals after a server restart.
const secret = process.env.AI_VERIFICATION_SECRET || randomBytes(32).toString('hex');
const digestFiles = (files: unknown): string | null => {
  if (!Array.isArray(files) || files.length < 1 || files.length > 10) return null;
  const normalized: { path: string; content: string; baseHash: string | null }[] = [];
  for (const raw of files) {
    if (!raw || typeof raw !== 'object') return null;
    const file = raw as Partial<DraftFile>;
    if (typeof file.path !== 'string' || typeof file.content !== 'string' ||
        !(file.baseHash === null || (typeof file.baseHash === 'string' && /^[a-f0-9]{64}$/.test(file.baseHash)))) return null;
    normalized.push({ path: file.path, content: file.content, baseHash: file.baseHash });
  }
  normalized.sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(normalized.map(file => file.path)).size !== normalized.length) return null;
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
};
function signature(projectId: string, digest: string, expiresAt: number) {
  return createHmac('sha256', secret).update(projectId + ':' + digest + ':' + expiresAt, 'utf8').digest('hex');
}
export function issueVerificationProof(projectId: string, files: unknown): string | null {
  const digest = digestFiles(files);
  if (!digest || !projectId) return null;
  const expiresAt = Date.now() + 10 * 60 * 1000;
  return expiresAt + '.' + digest + '.' + signature(projectId, digest, expiresAt);
}
export function verifyVerificationProof(projectId: string, files: unknown, proof: unknown): boolean {
  if (typeof proof !== 'string' || !projectId) return false;
  const parts = proof.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now() || expiresAt > Date.now() + 10 * 60 * 1000) return false;
  const digest = digestFiles(files);
  if (!digest || digest !== parts[1]) return false;
  const expected = Buffer.from(signature(projectId, digest, expiresAt), 'hex');
  const actual = Buffer.from(parts[2], 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
