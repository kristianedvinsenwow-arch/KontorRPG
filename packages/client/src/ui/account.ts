/**
 * Account box on the start screen: a username and a 4–6 digit PIN. This browser remembers the
 * username, so next time it's just the PIN. There's no email and no recovery: forget the PIN and
 * the character is lost. With a saved character the creator becomes read-only ("Continue as …").
 */
import type { Auth } from '../net/auth.js';
import { settingsStore } from '../state/store.js';
import { setCreatorLocked, setEnterBlocked } from './creator.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export function initAccount(auth: Auth): void {
  const box = document.getElementById('account')!;
  if (!auth.enabled) return; // guests only on this server
  box.hidden = false;
  let mode: 'login' | 'create' = auth.remembered ? 'login' : 'create';
  let msg = '';

  function render() {
    box.replaceChildren(el('div', 'lbl', 'Account'));

    if (!auth.loggedIn) {
      setCreatorLocked(null);
      setEnterBlocked(auth.config.requireLogin ? 'Log in to play' : null);
      const remembered = auth.remembered;
      const intro = el('p', 'note', mode === 'create'
        ? 'Pick a username and a 4–6 digit PIN. No email needed — but there’s no way to recover a forgotten PIN.'
        : remembered ? `Welcome back, ${remembered}. Enter your PIN.` : 'Log in with your username and PIN.');
      const row = el('div', 'loginrow');
      const user = el('input'); user.type = 'text'; user.placeholder = 'Username'; user.maxLength = 16; user.autocomplete = 'username'; user.id = 'userIn';
      user.value = mode === 'login' ? remembered : '';
      const pin = el('input'); pin.type = 'password'; pin.inputMode = 'numeric'; pin.pattern = '[0-9]*'; pin.maxLength = 6; pin.placeholder = 'PIN (4–6 digits)'; pin.autocomplete = mode === 'create' ? 'new-password' : 'current-password'; pin.id = 'pinIn';
      pin.oninput = () => { pin.value = pin.value.replace(/\D/g, '').slice(0, 6); };
      const go = el('button', 'btn', mode === 'create' ? 'Create account' : 'Log in');
      const err = el('p', 'note bad', msg);
      go.onclick = async () => {
        if (!/^\d{4,6}$/.test(pin.value)) { msg = 'Your PIN is 4 to 6 digits.'; return render(); }
        go.disabled = true;
        const e = await auth.login(user.value.trim(), pin.value, mode === 'create');
        go.disabled = false;
        msg = e ?? '';
        if (e?.startsWith('No account')) mode = 'create';
        render();
      };
      for (const i of [user, pin]) i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go.click(); });
      // When the name is remembered, show it as text with a "not you?" link instead of a field.
      if (mode === 'login' && remembered) {
        const who = el('p', 'note');
        const notMe = el('button', 'linkbtn', 'Not you?');
        notMe.onclick = () => { auth.forget(); mode = 'login'; msg = ''; render(); };
        who.append(`Logged out · ${remembered} `, notMe);
        row.append(pin, go);
        box.append(intro, row, err, who);
        user.value = remembered;
        go.onclick = async () => {
          if (!/^\d{4,6}$/.test(pin.value)) { msg = 'Your PIN is 4 to 6 digits.'; return render(); }
          go.disabled = true;
          const e = await auth.login(remembered, pin.value, false);
          go.disabled = false;
          msg = e ?? '';
          render();
        };
      } else {
        row.append(user, pin, go);
        box.append(intro, row, err);
      }
      const sw = el('button', 'linkbtn', mode === 'create' ? 'I already have an account' : 'New here? Create an account');
      sw.onclick = () => { mode = mode === 'create' ? 'login' : 'create'; msg = ''; render(); };
      const tail = el('p', 'note'); tail.append(sw);
      if (!auth.config.requireLogin) tail.append(' · or play as a guest (not saved)');
      box.append(tail);
      setTimeout(() => (mode === 'login' && remembered ? pin : user).focus(), 0);
      return;
    }

    setEnterBlocked(null);
    const who = el('p', 'note', `Logged in as ${auth.username}. `);
    const out = el('button', 'linkbtn', 'Log out');
    out.onclick = () => { auth.signOut(); mode = 'login'; };
    who.append(out);
    box.append(who);
    const saved = auth.character;
    if (saved) {
      settingsStore.set({ name: saved.name, color: saved.color, build: saved.build });
      setCreatorLocked({ name: saved.name });
      box.append(el('p', 'note welcome', `Welcome back, ${saved.name}. Your progress is saved to your account.`));
    } else {
      setCreatorLocked(null);
      box.append(el('p', 'note', 'No character yet — the one you create below is saved to your account when you enter the world.'));
    }
  }

  auth.onChange(render);
  render();
}
