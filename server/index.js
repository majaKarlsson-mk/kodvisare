// Startar Kodvisare: en server för själva verktyget och, när du väljer ett
// projekt, en server till som kör projektets sida med instrumenterad kod.
//
//   npm start                 letar projekt i mappen ovanför kodvisare
//   npm start -- ../en/mapp   letar projekt i en annan mapp
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry, kodvisarePlugin } from './plugin.js';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scanRoot = realpathSync(resolve(process.argv[2] ?? process.env.KODVISARE_ROOT ?? join(appDir, '..')));
const SKIP = new Set(['node_modules', 'dist', 'build', 'public', 'coverage']);

let project = null; // { dir, name, url, server, registry }

function findProjects(dir, depth, out) {
  if (depth > 6) return out;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  if (names.includes('index.html') && dir !== scanRoot) {
    out.push({ name: relative(scanRoot, dir).split(sep).join('/'), path: dir });
  }
  for (const name of names) {
    if (name.startsWith('.') || SKIP.has(name)) continue;
    const full = join(dir, name);
    if (full === appDir) continue;
    try {
      if (statSync(full).isDirectory()) findProjects(full, depth + 1, out);
    } catch {}
  }
  return out;
}

// Inklistrad kod sparas som ett litet projekt i en egen mapp och körs som vilket projekt som helst
const snippetDir = join(appDir, '.klistra-in');
const SNIPPET_NAME = 'Inklistrad kod';

function readSnippet() {
  const read = (f) => (existsSync(join(snippetDir, f)) ? readFileSync(join(snippetDir, f), 'utf8') : '');
  return { code: read('kod.js'), html: read('sida.html') };
}

async function runSnippet(code, html) {
  mkdirSync(snippetDir, { recursive: true });
  writeFileSync(join(snippetDir, 'kod.js'), code);
  writeFileSync(join(snippetDir, 'sida.html'), html);
  const body = html.trim() || '<p class="tom">Koden har ingen egen sida. Det som skrivs med console.log syns i panelen Konsol.</p>';
  writeFileSync(
    join(snippetDir, 'index.html'),
    `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <title>Inklistrad kod</title>
    <style>
      body { font: 16px system-ui, sans-serif; padding: 20px; }
      .tom { color: #6b6a66; }
    </style>
  </head>
  <body>
${body}
    <script type="module" src="kod.js"></script>
  </body>
</html>
`,
  );
  return openProject(snippetDir, SNIPPET_NAME);
}

async function openProject(dir, name) {
  dir = realpathSync(resolve(dir));
  if (dir !== scanRoot && !dir.startsWith(scanRoot + sep) && !dir.startsWith(appDir + sep)) throw new Error('Mappen ligger utanför ' + scanRoot);
  if (!existsSync(join(dir, 'index.html'))) throw new Error('Hittar ingen index.html i mappen');
  if (project) await project.server.close();
  project = null;

  const registry = createRegistry(dir);
  const config = {
    root: dir,
    appType: 'mpa',
    logLevel: 'error',
    clearScreen: false,
    // Vites cache hamnar hos Kodvisare, så att inget skrivs i ditt projekt
    cacheDir: join(appDir, 'node_modules', '.kodvisare', createHash('sha1').update(dir).digest('hex').slice(0, 12)),
    server: { port: 5181, strictPort: false, host: 'localhost', open: false },
    plugins: [kodvisarePlugin(registry)],
  };
  const hasConfig = ['js', 'mjs', 'ts'].some((ext) => existsSync(join(dir, 'vite.config.' + ext)));
  let server;
  try {
    server = await createServer(hasConfig ? config : { ...config, configFile: false });
  } catch (err) {
    if (!hasConfig) throw err;
    server = await createServer({ ...config, configFile: false });
  }
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:' + server.config.server.port + '/';
  project = { dir, name: name ?? relative(scanRoot, dir).split(sep).join('/'), url, server, registry };
  return { name: project.name, url };
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        ok(data ? JSON.parse(data) : {});
      } catch (e) {
        fail(e);
      }
    });
    req.on('error', fail);
  });
}

const api = {
  name: 'kodvisare-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = (req.url || '').split('?')[0];
      if (!url.startsWith('/api/')) return next();
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(body));
      };
      try {
        if (url === '/api/projects') {
          const projects = findProjects(scanRoot, 0, []).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
          // Kodvisares egna exempel, med buggar att öva på
          for (const p of findProjects(join(appDir, 'test', 'fixtures'), 0, []).reverse()) {
            projects.unshift({ name: 'Kodvisares exempel/' + p.path.split(sep).pop(), path: p.path });
          }
          return send(200, { root: scanRoot, projects, current: project && { name: project.name, url: project.url } });
        }
        if (url === '/api/open' && req.method === 'POST') {
          const { path } = await readBody(req);
          return send(200, await openProject(String(path)));
        }
        if (url === '/api/snippet') {
          if (req.method !== 'POST') return send(200, readSnippet());
          const { code, html } = await readBody(req);
          return send(200, await runSnippet(String(code ?? ''), String(html ?? '')));
        }
        if (url === '/api/meta') {
          if (!project) return send(200, { files: [], problems: [] });
          return send(200, { files: project.registry.list(), problems: project.registry.problems });
        }
        send(404, { error: 'Finns inte' });
      } catch (err) {
        send(500, { error: err.message });
      }
    });
  },
};

const ui = await createServer({
  root: join(appDir, 'ui'),
  configFile: false,
  logLevel: 'error',
  clearScreen: false,
  server: { port: Number(process.env.PORT) || 5180, strictPort: false, host: 'localhost', open: !process.env.KODVISARE_NO_OPEN },
  plugins: [api],
});
await ui.listen();
console.log('\n  Kodvisare är igång: ' + (ui.resolvedUrls?.local?.[0] ?? 'http://localhost:5180/'));
console.log('  Letar projekt i:    ' + scanRoot + '\n');
