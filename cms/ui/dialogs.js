/* dialogs.js — свои окна вместо системных вопросов браузера.
   confirm() и prompt() блокируют всю вкладку, выглядят чужими и не умеют
   ни объяснить последствия, ни подсветить опасную кнопку. Здесь то же самое
   своими силами: окно в стиле CMS, Enter — подтвердить, Esc — отменить. */

// ask({title, text, ok, cancel, danger}) → Promise<boolean>
function ask(o) {
  o = typeof o === 'string' ? { title: o } : o;
  return new Promise((done) => {
    const v = document.createElement('div');
    v.className = 'veil veil--ask';
    v.innerHTML = '<div class="modal modal--ask" role="dialog" aria-modal="true">'
      + '<header><h3></h3></header>'
      + '<div class="body"></div>'
      + '<footer><button class="btn" data-a="no"></button><button class="btn pri" data-a="yes"></button></footer></div>';
    v.querySelector('h3').textContent = o.title || 'Подтверди';
    const body = v.querySelector('.body');
    if (o.text) body.innerHTML = '<p>' + String(o.text).split('\n\n').map(escDlg).join('</p><p>') + '</p>';
    else body.remove();
    const yes = v.querySelector('[data-a="yes"]'), no = v.querySelector('[data-a="no"]');
    yes.textContent = o.ok || 'Да';
    no.textContent = o.cancel || 'Отмена';
    if (o.danger) yes.classList.add('danger');
    const close = (r) => { document.removeEventListener('keydown', key, true); v.remove(); done(r); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
    };
    v.addEventListener('mousedown', (e) => { if (e.target === v) close(false); });
    yes.onclick = () => close(true);
    no.onclick = () => close(false);
    document.addEventListener('keydown', key, true);
    document.body.appendChild(v);
    (o.danger ? no : yes).focus();
  });
}

// askText({title, text, value, placeholder, ok, need}) → Promise<string|null>
// need — строка, которую надо ввести точно: кнопка не активна, пока не совпало.
function askText(o) {
  return new Promise((done) => {
    const v = document.createElement('div');
    v.className = 'veil veil--ask';
    v.innerHTML = '<div class="modal modal--ask" role="dialog" aria-modal="true">'
      + '<header><h3></h3></header>'
      + '<div class="body"><div class="dlgtext"></div><input class="dlginput" autocomplete="off" spellcheck="false"></div>'
      + '<footer><button class="btn" data-a="no">Отмена</button><button class="btn pri" data-a="yes"></button></footer></div>';
    v.querySelector('h3').textContent = o.title || '';
    const txt = v.querySelector('.dlgtext');
    if (o.text) txt.innerHTML = '<p>' + String(o.text).split('\n\n').map(escDlg).join('</p><p>') + '</p>'; else txt.remove();
    const inp = v.querySelector('.dlginput'), yes = v.querySelector('[data-a="yes"]');
    inp.value = o.value || '';
    inp.placeholder = o.placeholder || '';
    yes.textContent = o.ok || 'Готово';
    if (o.danger) yes.classList.add('danger');
    const valid = () => (o.need != null ? inp.value.trim() === String(o.need).trim() : inp.value.trim() !== '');
    const sync = () => { yes.disabled = !valid(); };
    const close = (r) => { document.removeEventListener('keydown', key, true); v.remove(); done(r); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && valid()) { e.preventDefault(); e.stopPropagation(); close(inp.value.trim()); }
    };
    inp.oninput = sync;
    v.addEventListener('mousedown', (e) => { if (e.target === v) close(null); });
    yes.onclick = () => { if (valid()) close(inp.value.trim()); };
    v.querySelector('[data-a="no"]').onclick = () => close(null);
    document.addEventListener('keydown', key, true);
    document.body.appendChild(v);
    sync(); inp.focus(); inp.select();
  });
}

function escDlg(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// Уведомление с действием: «Экран скрыт · Вернуть». Заменяет вопрос «точно?»
// там, где действие легко отменить, — человек не тратит клик на подтверждение.
function toastAction(msg, label, fn, ms) {
  const t = document.createElement('div');
  t.className = 'toast toast--act';
  const s = document.createElement('span'); s.textContent = msg;
  const b = document.createElement('button'); b.textContent = label;
  b.onclick = () => { t.remove(); fn(); };
  t.append(s, b);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || 7000);
  return t;
}
