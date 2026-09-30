/** Canonical waitlist identity; provider-specific dots and plus tags stay intact. */
export function normalizeEmail(input: string): string | null {
  // Outer spaces are convenient; control characters (including tabs/newlines) are not.
  // eslint-disable-next-line no-control-regex -- Reject controls before trimming input.
  if (/[\u0000-\u001f\u007f]/.test(input)) return null
  const value = input.trim().toLowerCase()
  if (!value || value.length > 254 || /\s/.test(value)) return null
  const parts = value.split('@')
  if (parts.length !== 2) return null
  const [local, domain] = parts
  if (!local || local.length > 64 || !domain || domain.length > 253) return null
  // Accept ordinary unquoted ASCII mailbox names; no leading/trailing/repeated dots.
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return null
  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((label) =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) return null
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1)!)) return null
  return value
}
