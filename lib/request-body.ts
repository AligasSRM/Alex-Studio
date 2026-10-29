export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Read JSON without allowing unbounded request bodies to be buffered in memory.
 * Callers should still validate the parsed value and enforce field-level limits.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, status: 413, error: 'Request body too large' };
    }
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Invalid request body' };
  }

  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, status: 413, error: 'Request body too large' };
  }

  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'Malformed JSON' };
  }
}
