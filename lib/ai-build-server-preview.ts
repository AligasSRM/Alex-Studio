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

const unavailable = (summary: string, output: string): BuildPreviewResult => ({
  ok: false,
  available: false,
  status: 'UNAVAILABLE',
  summary,
  output,
  url: null,
  pageSnapshot: null,
  cleanupVerified: false,
});

/**
 * Do not run generated build or server commands on the Windows host. The former
 * Former non-Windows execution support is out of scope. This remains unavailable until a
 * reviewed Windows-native isolation provider is implemented and verified.
 */
export async function runBuildServerPreview(_root: string): Promise<BuildPreviewResult> {
  return unavailable(
    'Windows-native isolated build/server preview is not implemented',
    'A Windows-native isolation provider is required before preview can run. No generated command or server was started. Direct host execution is prohibited.',
  );
}
