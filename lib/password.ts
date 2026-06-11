// Shared password rules for every place an admin sets a password:
// staff create/edit, owner account, and own password change.

export function validatePassword(pw: string, username?: string): string | null {
  if (pw.length < 8) return 'Şifrə ən az 8 simvol olmalıdır';
  if (!/[a-zA-ZəöüğışçƏÖÜĞİŞÇ]/.test(pw)) return 'Şifrədə ən az bir hərf olmalıdır';
  if (!/\d/.test(pw)) return 'Şifrədə ən az bir rəqəm olmalıdır';
  if (username && pw.toLowerCase() === username.trim().toLowerCase()) return 'Şifrə istifadəçi adı ilə eyni ola bilməz';
  return null;
}

/** 0 = zəif (red), 1 = orta (orange), 2 = yaxşı (yellow), 3 = güclü (green) */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 1) return 0;
  if (score === 2) return 1;
  if (score === 3) return 2;
  return 3;
}

// Pronounceable and easy to dictate over the phone, e.g. "Kofera42-Pasu",
// yet long and random enough to satisfy the rules above.
export function generatePassword(): string {
  const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const cons = 'bdfgkmnprstvz';
  const vow = 'aeiou';
  const syllable = () => cons[rand(cons.length)] + vow[rand(vow.length)];
  const word = (n: number) => {
    const w = Array.from({ length: n }, syllable).join('');
    return w[0].toUpperCase() + w.slice(1);
  };
  const digits = String(10 + rand(90));
  return `${word(3)}${digits}-${word(2)}`;
}
