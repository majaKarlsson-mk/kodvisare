// Panelerna "Anropskedja" och "Konsol".
import { short } from '../format.js';
import { $, baseName, el } from '../dom.js';

export function createStackView(app) {
  const { store } = app;
  const body = $('#stack .body');

  function render() {
    const step = store.step(app.n);
    if (!step) {
      body.replaceChildren(el('p', { class: 'hint' }, 'Här visas vilka funktioner som ledde fram till raden du står på.'));
      return;
    }
    const chain = store.stack(step.frame);
    const out = chain.map((f, k) => {
      const at = store.loc(f.callLoc);
      const sig =
        f.id < 0
          ? 'Toppnivå i ' + baseName(store.frameName(f))
          : store.frameName(f) + '(' + store.args(f).map((a) => a.name + ' = ' + (a.entry ? short(a.entry.snap, 20) : '?')).join(', ') + ')';
      const from = f.parent && at ? 'anropad från rad ' + at.line + ' i ' + baseName(at.file.rel) : '';
      const target = f.parent && f.callStep >= store.first ? f.callStep : f.first;
      return el(
        'button',
        { type: 'button', class: 'frame-row' + (k === 0 ? ' top' : ''), onclick: () => target >= 0 && app.go(target) },
        el('span', { class: 'sig' }, sig),
        from && el('span', { class: 'from' }, from),
      );
    });
    const job = store.jobOf(step.frame);
    out.push(
      el(
        'button',
        {
          type: 'button',
          class: 'frame-row',
          onclick: () => job && job.origin >= 0 && app.go(store.stepOfEvent(job.origin)),
          title: job && job.origin >= 0 ? 'Gå till raden som satte upp det här' : '',
        },
        el('span', { class: 'from' }, job ? 'Startades av: ' + job.label : 'Startades när sidan laddades'),
      ),
    );
    body.replaceChildren(...out);
  }

  return { render };
}

export function createConsoleView(app) {
  const { store } = app;
  const body = $('#console .body');
  const count = $('#console .count');

  function render() {
    const iEnd = app.n >= 0 ? store.endOf(app.n) : -1;
    const logs = store.logs.filter((l) => l.i <= iEnd);
    count.textContent = logs.length ? '(' + logs.length + ')' : '';
    if (!logs.length) {
      body.replaceChildren(el('p', { class: 'hint' }, 'Inget har skrivits med console.log än.'));
      return;
    }
    body.replaceChildren(
      ...logs.slice(-100).map((l) =>
        el(
          'button',
          { type: 'button', class: 'rowbtn ' + l.level, onclick: () => app.go(l.step) },
          el('span', { class: 'what' }, l.args.map((a) => (typeof a === 'string' ? a : short(a, 80))).join(' ')),
        ),
      ),
    );
  }

  return { render };
}
