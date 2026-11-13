// Vite-plugin som instrumenterar projektets JavaScript på väg till webbläsaren.
// Filerna på disk ändras aldrig: omskrivningen sker bara i svaret.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrument, newMeta } from './instrument.js';

// macOS kan skriva Ö på två olika sätt i en sökväg. NFC gör att de går att jämföra.
const norm = (p) => p.normalize('NFC');

const runtimeDir = fileURLToPath(new URL('../runtime/', import.meta.url));
const RUNTIME_URL = '/@kodvisare/runtime.js';

// Håller reda på filerna i det öppna projektet: id, källkod och fakta om koden.
export function createRegistry(root) {
  root = norm(root);
  const files = new Map();
  let nextId = 1;
  return {
    root,
    files,
    classic: new Set(), // filer som laddas med vanlig <script src>, inte type="module"
    problems: [],
    entry(file, source) {
      file = norm(file);
      let f = files.get(file);
      if (!f) {
        f = { id: nextId++, rel: relative(root, file).split(sep).join('/'), source, meta: newMeta() };
        files.set(file, f);
      }
      f.source = source;
      f.meta = newMeta();
      return f;
    },
    list() {
      return [...files.values()].map(({ id, rel, source, meta }) => ({ id, rel, source, meta }));
    },
  };
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const attr = (attrs, name) => {
  const m = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
};

// results: visa värdet av uttryckssatser på toppnivå (skrivblocket)
export function kodvisarePlugin(registry, { results = false } = {}) {
  const { root } = registry;
  const inRoot = (file) => file === root || file.startsWith(root + sep);
  const isClassic = (file) => registry.classic.has(norm(file));
  const isOurs = (file) => inRoot(norm(file)) && !file.includes(sep + 'node_modules' + sep) && /\.(js|mjs)$/.test(file);

  function run(file, code, mode) {
    const entry = registry.entry(file, code);
    registry.problems = registry.problems.filter((p) => p.file !== entry.rel);
    try {
      return instrument(code, { fileId: entry.id, mode, meta: entry.meta, results }).code;
    } catch (err) {
      // Syntaxfel: skicka koden som den är, så visar webbläsaren felet
      registry.problems.push({ file: entry.rel, message: err.message });
      return null;
    }
  }

  return {
    name: 'kodvisare',
    enforce: 'pre',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url === RUNTIME_URL) {
          const code = ['snapshot.js', 'tracer.js', 'async-hooks.js']
            .map((f) => readFileSync(join(runtimeDir, f), 'utf8'))
            .join('\n');
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(code);
          return;
        }
        // Klassiska skript går inte genom Vites modulhantering, så de sköts här
        let file;
        try {
          file = join(root, decodeURIComponent(url));
        } catch {
          return next();
        }
        if (isClassic(file) && existsSync(file)) {
          const code = readFileSync(file, 'utf8');
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(run(file, code, 'script') ?? code);
          return;
        }
        next();
      });
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const htmlFile = ctx.filename;
        const entry = registry.entry(htmlFile, html);
        const out = html.replace(SCRIPT_RE, (whole, attrs, content, offset) => {
          const type = (attr(attrs, 'type') || '').toLowerCase();
          const isModule = type === 'module';
          if (type && !isModule && type !== 'text/javascript') return whole;
          const src = attr(attrs, 'src');
          if (src != null) {
            if (!isModule && !/^([a-z]+:)?\/\//i.test(src)) {
              const clean = src.split(/[?#]/)[0];
              registry.classic.add(norm(clean.startsWith('/') ? join(root, clean) : resolve(dirname(htmlFile), clean)));
            }
            return whole;
          }
          if (!content.trim()) return whole;
          const baseOffset = offset + whole.indexOf('>') + 1;
          try {
            const { code } = instrument(content, {
              fileId: entry.id,
              mode: isModule ? 'module' : 'script',
              baseOffset,
              meta: entry.meta,
              results,
            });
            return '<script' + attrs + '>' + code + '</script>';
          } catch (err) {
            registry.problems.push({ file: entry.rel, message: err.message });
            return whole;
          }
        });
        return {
          html: out,
          tags: [{ tag: 'script', attrs: { src: RUNTIME_URL }, injectTo: 'head-prepend' }],
        };
      },
    },

    transform(code, id) {
      if (id.includes('html-proxy')) return null; // inline-skript är redan omskrivna ovan
      const file = id.split('?')[0];
      if (!isOurs(file) || isClassic(file)) return null;
      const out = run(file, code, 'module');
      return out == null ? null : { code: out, map: null };
    },
  };
}
