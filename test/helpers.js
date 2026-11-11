// Kör instrumenterad kod i en egen sandlåda och samlar händelserna.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { instrument } from '../server/instrument.js';
import { Store } from '../ui/store.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const runtime = read('../runtime/snapshot.js') + '\n' + read('../runtime/tracer.js');

export async function run(code, { fileId = 1, mode = 'script', wait = 20 } = {}) {
  const { code: out, meta } = instrument(code, { fileId, mode });
  const events = [];
  const logs = [];
  const context = vm.createContext({
    __kvSink: events,
    console: { log: (...a) => logs.push(a) },
    setTimeout,
    queueMicrotask,
  });
  vm.runInContext(runtime, context);
  let error = null;
  try {
    vm.runInContext(out, context);
  } catch (e) {
    error = e;
  }
  await new Promise((r) => setTimeout(r, wait));
  return { events, meta, logs, out, error, source: code, fileId };
}

// Bygg ett lager av en körning, som gränssnittet gör
export function storeOf(r) {
  const store = new Store();
  store.setFiles([{ id: r.fileId, rel: 'test.js', source: r.source, meta: r.meta }]);
  store.add(r.events);
  return store;
}
