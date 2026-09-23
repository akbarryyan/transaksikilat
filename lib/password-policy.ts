/**
 * One place for the rules about passwords being *set*.
 *
 * Deliberately not applied when a password is being *checked* at login: the
 * minimum went up, and enforcing the new floor there would lock out every
 * account that still has a shorter one. They are asked for something longer the
 * next time they change it.
 */

/**
 * bcrypt work factor for new hashes. A hash carries the cost it was made with,
 * so raising this only affects passwords set from here on — existing ones keep
 * verifying as they are.
 */
export const BCRYPT_COST = 12;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Not a breach corpus — just the handful that turn up first in any guessing
 * run, including the ones common in Indonesian sign-ups. Enough to stop the
 * worst choices without pretending to be a real strength check.
 */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwertyui",
  "qwerty123",
  "asdfghjk",
  "asdfghjkl",
  "iloveyou",
  "sayangku",
  "rahasia123",
  "admin123",
  "adminadmin",
  "administrator",
  "indonesia",
  "bismillah",
  "alhamdulillah",
  "abcd1234",
  "abc12345",
  "letmein1",
  "welcome1",
  "trustno1",
  "sunshine",
  "princess",
  "whatever",
  "football",
  "baseball",
  "monkey123",
  "dragon123",
  "jakarta123",
  "topupgame",
  "whuzpay123",
]);

/** Returns a message to show the user, or null when the password is acceptable. */
export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password wajib diisi.";
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }

  if (/^(.)\1+$/.test(password)) {
    return "Password tidak boleh satu karakter yang diulang terus.";
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Password ini terlalu umum dan mudah ditebak. Pilih yang lain.";
  }

  return null;
}
