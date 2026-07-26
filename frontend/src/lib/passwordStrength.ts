/** Client-side password strength — mirrors the backend policy
 * (services/passwords.py) for instant feedback. The server re-validates; this
 * is UX only, never a security boundary. */

export const MIN_PASSWORD_LENGTH = 8;

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface Strength {
  /** 0 = too short/empty … 4 = strong. Drives the meter. */
  level: StrengthLevel;
  /** Meets the minimum policy (length + ≥2 character classes). */
  acceptable: boolean;
}

function classesUsed(pw: string): number {
  return (
    Number(/[a-zäöüß]/.test(pw)) +
    Number(/[A-ZÄÖÜ]/.test(pw)) +
    Number(/\d/.test(pw)) +
    Number(/[^a-zA-Z0-9äöüßÄÖÜ]/.test(pw))
  );
}

/** Rate a password 0–4 and whether it clears the minimum policy. */
export function passwordStrength(pw: string): Strength {
  if (pw.length < MIN_PASSWORD_LENGTH) return { level: pw ? 1 : 0, acceptable: false };
  const classes = classesUsed(pw);
  const acceptable = classes >= 2;
  let level: StrengthLevel = 2;
  if (classes >= 3 && pw.length >= 10) level = 3;
  if (classes >= 4 && pw.length >= 12) level = 4;
  if (!acceptable) level = 1;
  return { level, acceptable };
}
