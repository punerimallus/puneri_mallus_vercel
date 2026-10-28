// Turning an error into something worth showing a person.
//
// Authentication SDKs throw developer-facing strings: Firebase says
// "Firebase: Error (auth/invalid-verification-code)." and Supabase says "Invalid login
// credentials". Putting those on screen tells the person nothing useful, looks broken, and
// quietly advertises which services sit behind the site.
//
// So: known failures get a sentence that says what went wrong and what to do about it, and
// anything unrecognised falls back to a plain message rather than leaking the raw text.

/** Firebase phone-auth failures a real person can actually hit. */
const FIREBASE: Record<string, string> = {
  'auth/invalid-verification-code': 'That code is not right. Check the 6 digits and try again.',
  'auth/missing-verification-code': 'Enter the 6-digit code we sent you.',
  'auth/code-expired': 'That code has expired. Tap resend to get a new one.',
  'auth/session-expired': 'That code has expired. Tap resend to get a new one.',
  'auth/invalid-verification-id': 'This sign-in attempt expired. Please start again.',
  'auth/invalid-phone-number': 'That mobile number does not look right. Enter 10 digits.',
  'auth/missing-phone-number': 'Enter your mobile number.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes before trying again.',
  'auth/quota-exceeded': 'We could not send a code just now. Please try again in a few minutes.',
  'auth/network-request-failed': 'Check your internet connection and try again.',
  'auth/captcha-check-failed': 'We could not verify your browser. Reload the page and try again.',
  'auth/invalid-app-credential': 'We could not verify your browser. Reload the page and try again.',
  'auth/user-disabled': 'This account has been disabled. Please contact us for help.',
  'auth/operation-not-allowed': 'Phone sign-in is unavailable right now. Please try again later.',
  'auth/credential-already-in-use': 'That number is already linked to another account.',
};

/** Supabase auth messages, matched on the text because it does not expose codes consistently. */
const SUPABASE: [RegExp, string][] = [
  [/invalid login credentials/i, 'That email or password is not right.'],
  [/email not confirmed/i, 'Please confirm your email first — check your inbox for the link.'],
  [/user already registered|already been registered/i, 'An account already exists for that email.'],
  [/password should be at least/i, 'Please choose a longer password (at least 6 characters).'],
  [/for security purposes.*(\d+) seconds/i, 'Please wait a moment before trying that again.'],
  [/rate limit|too many requests/i, 'Too many attempts. Please wait a few minutes and try again.'],
  [/token has expired or is invalid|otp_expired/i, 'That link or code has expired. Please request a new one.'],
  [/user not found/i, 'We could not find an account for that.'],
  [/network|fetch failed/i, 'Check your internet connection and try again.'],
];

/**
 * Does this read like something only a developer should see?
 *
 * Our own API returns sentences written for the person ("GENERAL just sold out. Nothing has been
 * charged."), and those should pass straight through. SDK output, stack traces and HTTP noise
 * should not.
 */
export function looksTechnical(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  if (m.length > 200) return true;
  return (
    /firebase|supabase|postgrest|razorpay|gotrue/i.test(m)
    || /\bauth\/[a-z-]+/i.test(m)        // auth/invalid-verification-code
    || /^[A-Z_]+[A-Z_0-9]*:/.test(m)      // SOLD_OUT: ... and other raised codes
    || /\b(?:TypeError|ReferenceError|SyntaxError|Error:)\b/.test(m)
    || /\bat\s+\w+\s+\(/.test(m)          // stack frame
    || /\b[45]\d{2}\b.*\b(?:status|code)\b/i.test(m)
    || /\{|\}|<[a-z]+>/i.test(m)          // JSON or markup
    // Whole words only: "annulled" and "cancelled" are ordinary English and must survive.
    || /\b(?:undefined|null|NaN)\b/.test(m)
    // Database talk: "column x does not exist", "duplicate key value violates ...".
    || /\b(?:column|relation|constraint|duplicate key|violates|syntax error at)\b/i.test(m)
    || /\b\w+\.\w+ does not exist\b/i.test(m)
  );
}

/** Pulls a Firebase error code out of whatever shape the error arrived in. */
function firebaseCode(err: unknown): string | null {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && code.startsWith('auth/')) return code;

  // The error may be an Error, or just the string someone already stringified.
  const message = typeof err === 'string' ? err : (err as { message?: unknown })?.message;
  if (typeof message === 'string') {
    const found = /\(?(auth\/[a-z-]+)\)?/i.exec(message);
    if (found) return found[1].toLowerCase();
  }
  return null;
}

/**
 * A sentence to show the person.
 *
 * `fallback` is used whenever the error is unrecognised or reads like developer output, so the
 * raw text never reaches the screen.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;

  const code = firebaseCode(err);
  if (code && FIREBASE[code]) return FIREBASE[code];
  // A Firebase code we have not listed: still never show the raw string.
  if (code) return fallback;

  const raw = typeof err === 'string' ? err : String((err as { message?: unknown })?.message ?? '');
  if (!raw) return fallback;

  for (const [pattern, friendly] of SUPABASE) {
    if (pattern.test(raw)) return friendly;
  }

  // Anything left that was written for a person can be shown as-is.
  return looksTechnical(raw) ? fallback : raw;
}
