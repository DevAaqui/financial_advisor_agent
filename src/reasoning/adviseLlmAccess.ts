/**
 * If allowlist is empty, everyone may use the LLM path (only `GEMINI_API_KEY` gating).
 * If non-empty, `userEmail` must match a list entry (case-insensitive).
 */
export function isUserAllowedForLlm(
  userEmail: string | undefined,
  allowlist: readonly string[]
): boolean {
  if (allowlist.length === 0) return true;
  const e = userEmail?.trim().toLowerCase();
  if (!e) return false;
  return allowlist.includes(e);
}
