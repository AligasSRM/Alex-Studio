import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export type WindowsPrivatePathKind = 'file' | 'directory';

function currentUserSid(): string {
  if (process.platform !== 'win32') {
    throw new Error('UNAVAILABLE: private metadata storage requires the Windows 10 ACL provider.');
  }
  const output = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const matches = output.match(/S-\d-\d+(?:-\d+)+/g);
  const sid = matches?.[matches.length - 1];
  if (!sid) throw new Error('UNAVAILABLE: could not determine the current Windows user SID.');
  return sid;
}

/**
 * Replace inherited/default ACLs with explicit full-control entries for the
 * current Windows user and SYSTEM, then ask icacls to verify the resulting ACL.
 * This is intentionally Windows-only; POSIX mode bits are not a security control.
 */
export function secureWindowsPrivatePath(target: string, kind: WindowsPrivatePathKind): void {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Private metadata paths must not be symbolic links or junctions.');
  if (kind === 'directory' && !stat.isDirectory()) throw new Error('Private metadata path must be a real directory.');
  if (kind === 'file' && !stat.isFile()) throw new Error('Private metadata path must be a regular file.');

  const sid = currentUserSid();
  const rights = kind === 'directory' ? '(OI)(CI)F' : 'F';
  execFileSync('icacls.exe', [
    target,
    '/reset',
    '/inheritance:r',
    '/grant:r',
    '*' + sid + ':' + rights,
    '*S-1-5-18:' + rights,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('icacls.exe', [target, '/verify'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
