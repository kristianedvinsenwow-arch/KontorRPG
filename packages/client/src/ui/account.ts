/**
 * Account box on the start screen: a username and a 4–6 digit PIN. This browser remembers the
 * username, so next time it's just the PIN. There's no email and no recovery: forget the PIN and
 * the character is lost. With a saved character the creator becomes read-only ("Continue as …").
 */
import { EQUIP_SLOTS, ITEMS, RACES, SKILLS, levelFromXp, titleOf } from '@kontor/shared';
import type { Auth, SavedCharacter } from '../net/auth.js';
import { icon } from './panels.js';
import { attachTip, itemTip } from './tooltip.js';
import { settingsStore } from '../state/store.js';
import { setCreatorLocked, setEnterBlocked } from './creator.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** Your saved character at a glance, shown instead of the creator once you're logged in. */
function renderSummary(c: SavedCharacter | null): void {
  const box = document.getElementById('savedSummary')!;
  if (!c) { box.replaceChildren(); return; }
  const xp = c.xp ?? {};
  const lvl = levelFromXp(xp.combat ?? 0);
  const title = titleOf(c.title);
  const head = el('div', 'savedhead');
  head.append(el('b', '', c.name), el('span', 'note', [RACES[c.build.race]?.name, `Level ${lvl}`, title, `${(c.gold ?? 0).toLocaleString('en')} g`].filter(Boolean).join(' · ')));
  const gear = el('div', 'savedgear');
  for (const { slot, label } of EQUIP_SLOTS) {
    const s = c.equip?.[slot];
    if (s && ITEMS[s.id]) { const i = icon(s); attachTip(i, () => itemTip(s)); gear.append(i); }
    else { const e = el('div', 'icon empty'); e.title = label; gear.append(e); }
  }
  const skills = el('div', 'savedskills');
  for (const s of SKILLS) {
    if (s.id === 'combat') continue;
    const row = el('span', 'sk'); row.append(el('span', '', s.name), el('b', '', String(levelFromXp(xp[s.id] ?? 0)))); skills.append(row);
  }
  box.replaceChildren(head, el('div', 'lbl', 'Equipment'), gear, el('div', 'lbl', 'Skills'), skills);
}

export function initAccount(auth: Auth): void {
  const box = document.getElementById('account')!;
  if (!auth.enabled) return; // guests only on this server
  box.hidden = false;
  let mode: 'login' | 'create' = auth.remembered ? 'login' : 'create';
  let msg = '';
  let resetting = false;

  function render() {
    box.replaceChildren(el('div', 'lbl', 'Account'));

    if (!auth.loggedIn) {
      renderSummary(null);
      setCreatorLocked(null);
      // Someone who has an account here shouldn't wander in as a guest by accident (and "lose" everything).
      setEnterBlocked(auth.config.requireLogin || auth.remembered ? 'Log in to play' : null);
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
        // The username, hidden but present, so the browser's password manager pairs the PIN with it
        // (instead of guessing some other text box — like the chat — and filling your name in there).
        const hiddenUser = el('input'); hiddenUser.type = 'text'; hiddenUser.autocomplete = 'username'; hiddenUser.value = remembered; hiddenUser.readOnly = true; hiddenUser.hidden = true;
        row.append(hiddenUser);
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
    out.onclick = () => { resetting = false; auth.signOut(); mode = 'login'; };
    who.append(out);
    box.append(who);
    const saved = auth.character;
    renderSummary(saved);
    if (saved) {
      settingsStore.set({ name: saved.name, color: saved.color, build: saved.build });
      setCreatorLocked({ name: saved.name });
      if (!resetting) {
        const r = el('button', 'linkbtn', 'Reset character…');
        r.onclick = () => { resetting = true; msg = ''; render(); };
        const p = el('p', 'note'); p.append(r);
        box.append(p);
      } else {
        box.append(el('p', 'note bad', `This deletes ${saved.name} for good: levels, items, gold, home and achievements. Your username stays, and you make a new character below. Enter your PIN to confirm.`));
        const row = el('div', 'loginrow');
        const pin = el('input'); pin.type = 'password'; pin.inputMode = 'numeric'; pin.maxLength = 6; pin.placeholder = 'PIN'; pin.autocomplete = 'current-password';
        pin.oninput = () => { pin.value = pin.value.replace(/\D/g, '').slice(0, 6); };
        const go = el('button', 'btn danger', 'Delete & start over');
        const cancel = el('button', 'linkbtn', 'Cancel');
        cancel.onclick = () => { resetting = false; msg = ''; render(); };
        go.onclick = async () => {
          if (!/^\d{4,6}$/.test(pin.value)) { msg = 'Your PIN is 4 to 6 digits.'; return render(); }
          go.disabled = true;
          const e = await auth.resetCharacter(pin.value);
          go.disabled = false;
          msg = e ?? '';
          if (!e) resetting = false;
          render();
        };
        pin.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go.click(); });
        row.append(pin, go);
        box.append(row, el('p', 'note bad', msg));
        const c = el('p', 'note'); c.append(cancel); box.append(c);
        setTimeout(() => pin.focus(), 0);
      }
    } else {
      setCreatorLocked(null);
      box.append(el('p', 'note', 'No character yet — the one you create below is saved to your account when you enter the world.'));
    }
  }

  auth.onChange(render);
  render();
}
