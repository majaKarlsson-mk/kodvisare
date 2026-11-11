// Felrutan: vad som gick fel och varifrån det felaktiga värdet kom.
import { $, el, rich } from '../dom.js';

export function createErrorView(app) {
  const box = $('#error');

  function render() {
    const all = app.errors();
    if (!all.length) {
      box.hidden = true;
      return;
    }
    // Det senaste felet som har hänt vid det valda steget, annars det första
    const iEnd = app.n >= 0 ? app.store.endOf(app.n) : -1;
    const past = all.filter((x) => x.err.i <= iEnd);
    const { ex } = past.length ? past[past.length - 1] : all[0];
    const ahead = !past.length;

    box.hidden = false;
    box.replaceChildren(
      el(
        'div',
        { class: 'text' },
        el('div', { class: 'title' }, (ahead ? 'Längre fram: ' : '') + ex.title.replaceAll('`', '')),
        el('div', { class: 'msg' }, ex.message),
        ...ex.lines.map(rich),
        all.length > 1 && el('p', { class: 'muted' }, 'Totalt ' + all.length + ' fel i inspelningen.'),
      ),
      el(
        'div',
        { class: 'actions' },
        ex.step != null && el('button', { type: 'button', onclick: () => app.go(ex.step) }, 'Gå till felet'),
        ...ex.jumps.map((j) => el('button', { type: 'button', onclick: () => app.go(j.step) }, j.label)),
      ),
    );
  }

  return { render };
}
