/**
 * Whether the caller may use the Gemini path for Phase 3. Empty allowlist = unrestricted
 * (still need `GEMINI_API_KEY`); otherwise email must be on the list (case-insensitive).
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
