import fs from 'node:fs';
import path from 'node:path';
import { inspectGeneratedProject, validateProjectTreeLimits } from './ai-command-runner';

export type BuildPreviewResult = {
  ok: boolean;
  available: boolean;
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  summary: string;
  output: string;
  url: string | null;
  pageSnapshot: { title: string; body: string; errors: string[] } | null;
  cleanupVerified: boolean;
};

function unavailable(summary: string, output: string): BuildPreviewResult {
  return { ok: false, available: false, status: 'UNAVAILABLE', summary, output, url: null, pageSnapshot: null, cleanupVerified: false };
}

/** Perform filesystem and manifest preflight only. Never start generated commands here. */
export async function runBuildServerPreview(root: string): Promise<BuildPreviewResult> {
  try {
    validateProjectTreeLimits(root);
  } catch (error) {
    return unavailable('Project cannot be safely previewed', error instanceof Error ? error.message : 'Project tree validation failed');
  }
  const plan = inspectGeneratedProject(root);
  if (plan.preflightError) return unavailable('Build/server preview preflight failed', plan.preflightError);
  if (plan.kind === 'static') return unavailable('Build and start scripts are required for server preview', 'No package.json was found.');
  const scripts = plan.packageJson?.scripts as Record<string, unknown> | undefined;
  if (!scripts || typeof scripts.build !== 'string' || typeof scripts.start !== 'string') {
    return unavailable('Build and start scripts are required for server preview', 'package.json must define both build and start scripts. No command was started.');
  }
  const cache = process.env.AI_RUNNER_NPM_CACHE;
  if (!cache || !fs.existsSync(cache) || !fs.statSync(cache).isDirectory()) {
    return unavailable('Offline npm cache is unavailable', 'A configured offline npm cache directory is required. No Docker, build, or server command was started.');
  }
  return unavailable(
    'Windows-native isolated build/server preview is not implemented',
    'All filesystem, manifest, lockfile, script, and cache preflight checks passed. A Windows-native isolation provider is required before execution. No generated command, Docker container, or server was started.',
  );
}
