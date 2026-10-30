/**
 * Account box on the start screen: log in by email link, see who you're logged in as, and load
 * your saved character. With a saved character the creator becomes read-only ("Continue as …").
 */
import type { Auth } from '../net/auth.js';
import { settingsStore } from '../state/store.js';
import { setCreatorLocked, setEnterBlocked } from './creator.js';

export function initAccount(auth: Auth): void {
  const box = document.getElementById('account')!;
  if (!auth.enabled) return; // guests only on this server
  box.hidden = false;
  let sent: string | null = null;

  async function render() {
    box.replaceChildren();
    const h = document.createElement('div');
    h.className = 'lbl';
    h.textContent = 'Account';
    box.append(h);

    if (!auth.session) {
      setCreatorLocked(null);
      setEnterBlocked(auth.config.requireLogin ? 'Log in to play' : null);
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = sent
        ? `Check ${sent} for a login link. Opening it brings you back here, logged in.`
        : auth.config.requireLogin ? 'Log in with your work email to play. Your character is saved to your account.'
          : 'Log in with your email to save your character, or play as a guest (not saved).';
      const row = document.createElement('div');
      row.className = 'loginrow';
      const email = document.createElement('input');
      email.type = 'email'; email.placeholder = 'you@company.no'; email.autocomplete = 'email'; email.id = 'emailIn';
      const btn = document.createElement('button');
      btn.className = 'btn'; btn.textContent = sent ? 'Resend link' : 'Send login link';
      btn.onclick = async () => {
        const v = email.value.trim();
        if (!/^\S+@\S+\.\S+$/.test(v)) { p.textContent = 'That doesn’t look like an email address.'; return; }
        btn.disabled = true;
        const err = await auth.sendLink(v);
        btn.disabled = false;
        if (err) { p.textContent = `Couldn’t send the link: ${err}`; return; }
        sent = v;
        void render();
      };
      email.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); e.stopPropagation(); });
      row.append(email, btn);
      box.append(p, row);
      return;
    }

    setEnterBlocked(null);
    const who = document.createElement('p');
    who.className = 'note';
    who.textContent = `Logged in as ${auth.email}. `;
    const out = document.createElement('button');
    out.className = 'linkbtn'; out.textContent = 'Log out';
    out.onclick = () => void auth.signOut();
    who.append(out);
    box.append(who);

    const saved = await auth.loadCharacter();
    if (saved) {
      settingsStore.set({ name: saved.name, color: saved.color, build: saved.build });
      setCreatorLocked({ name: saved.name });
      const n = document.createElement('p');
      n.className = 'note welcome';
      n.textContent = `Welcome back, ${saved.name}. Your character is saved to your account; changing race, stats or perks (respec) comes in a later update.`;
      box.append(n);
    } else {
      setCreatorLocked(null);
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = 'No character yet — the one you create below is saved to your account when you enter the world.';
      box.append(n);
    }
  }

  auth.onChange(() => void render());
  void render();
}
