/**
 * Accounts: a username and a 4–6 digit PIN. No email, and no recovery: forget the PIN and the
 * character is gone. The PIN is stored only as a salted scrypt hash; logins hand out a signed
 * token (HMAC) that the WebSocket hello carries, so a server restart doesn't log anyone out.
 *
 * Short PINs are guessable, so wrong PINs are rate-limited: 5 wrong tries lock that username for
 * 10 minutes, and 20 wrong tries from one address block it for 10 minutes.
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface Account { id: string; username: string; pinHash: string }

/** Where accounts live (Supabase table or memory). */
export interface AccountStore {
  findAccount(usernameLower: string): Promise<Account | null>;
  createAccount(username: string, pinHash: string): Promise<Account | null>; // null = name taken
}

export const USERNAME_RE = /^[A-Za-z0-9ÆØÅæøå_\-.]{3,16}$/;
export const PIN_RE = /^\d{4,6}$/;
const TOKEN_DAYS = 30;
const LOCK_MS = 10 * 60_000;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  const [v, s, k] = stored.split('$');
  if (v !== 's1' || !s || !k) return false;
  const want = Buffer.from(k, 'base64');
  const got = await scrypt(pin, Buffer.from(s, 'base64'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

export class Accounts {
  private failsByUser = new Map<string, { n: number; until: number }>();
  private failsByIp = new Map<string, { n: number; until: number }>();

  constructor(private readonly store: AccountStore, private readonly secret: string, private readonly now: () => number = Date.now) {}

  /** A login token: account id and expiry, signed. */
  sign(accountId: string): string {
    const body = `${accountId}.${this.now() + TOKEN_DAYS * 86400_000}`;
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
  }

  /** The account id inside a valid, unexpired token, else null. */
  verify(token: string): string | null {
    const i = token.lastIndexOf('.');
    if (i < 0 || token.length > 300) return null;
    const body = token.slice(0, i), sig = token.slice(i + 1);
    const want = createHmac('sha256', this.secret).update(body).digest('base64url');
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const j = body.lastIndexOf('.');
    const id = body.slice(0, j), exp = Number(body.slice(j + 1));
    return j > 0 && exp > this.now() ? id : null;
  }

  private locked(map: Map<string, { n: number; until: number }>, key: string, max: number): boolean {
    const f = map.get(key);
    if (!f) return false;
    if (f.until && f.until <= this.now()) { map.delete(key); return false; }
    return f.n >= max;
  }
  private fail(map: Map<string, { n: number; until: number }>, key: string, max: number): void {
    const f = map.get(key) ?? { n: 0, until: 0 };
    f.n++;
    if (f.n >= max) f.until = this.now() + LOCK_MS;
    map.set(key, f);
  }

  /** Log in (or create the account first). Returns a token and the account id, or an error for the player. */
  async login(username: string, pin: string, create: boolean, ip: string): Promise<{ token: string; accountId: string; username: string } | { error: string }> {
    username = username.trim();
    if (!USERNAME_RE.test(username)) return { error: 'Usernames are 3–16 letters, numbers, - _ or .' };
    if (!PIN_RE.test(pin)) return { error: 'Your PIN is 4 to 6 digits.' };
    const key = username.toLowerCase();
    if (this.locked(this.failsByIp, ip, 20)) return { error: 'Too many wrong PINs from here. Try again in 10 minutes.' };
    if (this.locked(this.failsByUser, key, 5)) return { error: 'Too many wrong PINs for this name. Try again in 10 minutes.' };
    if (create) {
      const acc = await this.store.createAccount(username, await hashPin(pin));
      if (!acc) return { error: 'That username is taken. Pick another, or log in if it’s yours.' };
      return { token: this.sign(acc.id), accountId: acc.id, username: acc.username };
    }
    const acc = await this.store.findAccount(key);
    if (!acc || !(await checkPin(pin, acc.pinHash))) {
      this.fail(this.failsByUser, key, 5);
      this.fail(this.failsByIp, ip, 20);
      return { error: acc ? 'Wrong PIN.' : 'No account with that name. Create one?' };
    }
    this.failsByUser.delete(key);
    return { token: this.sign(acc.id), accountId: acc.id, username: acc.username };
  }
}
