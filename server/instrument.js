// Skriver om JavaScript så att koden berättar vad den gör medan den körs.
//
//   const typ = data.type;
//
// blir ungefär
//
//   __kv.s(ram, 1200004);            // "nu körs satsen på den här platsen"
//   const typ = data.type;
//   __kv.v(ram, "typ", typ);         // "typ fick det här värdet"
//
// Samtidigt samlas fakta om koden i `meta`: var varje sats ligger, vilka
// funktioner som finns, var de anropas och vad som står till höger om varje =.
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;
const generate = generateModule.default ?? generateModule;

// Ett platsnummer är filens id * MUL + index i filens lista.
export const MUL = 100000;

const KEYWORD_NAMES = new Set(['let', 'async', 'await', 'of', 'static', 'get', 'set', 'from', 'as', 'yield']);
const ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

// Inbyggda objekt som inte är värda att visa som variabler.
const BUILTINS = new Set([
  'window', 'document', 'console', 'localStorage', 'sessionStorage', 'Math', 'JSON', 'Object', 'Array',
  'Number', 'String', 'Promise', 'navigator', 'location', 'history', 'globalThis', 'self', 'Date',
  'Intl', 'Reflect', 'Symbol', 'process', 'module', 'exports',
]);

export function newMeta() {
  return { locs: [null], fns: [null], refs: [], assigns: {}, members: {}, calls: {}, hl: [] };
}

const isMember = (n) => !!n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression');
const isCall = (n) => !!n && (n.type === 'CallExpression' || n.type === 'OptionalCallExpression');

// "a.b.c" -> ['a', 'b', 'c']. Null om uttrycket är något mer komplicerat.
function chainOf(n) {
  if (!n) return null;
  if (n.type === 'Identifier') return [n.name];
  if (n.type === 'ThisExpression') return ['this'];
  if (isMember(n)) {
    const head = chainOf(n.object);
    if (!head) return null;
    if (!n.computed && n.property.type === 'Identifier') return [...head, n.property.name];
    if (n.computed && (n.property.type === 'StringLiteral' || n.property.type === 'NumericLiteral')) {
      return [...head, String(n.property.value)];
    }
  }
  return null;
}

function rootOf(n) {
  while (isMember(n)) n = n.object;
  return n;
}

// En loopkropp utan satser som körs: ; eller {} (även { {} })
const isEmptyBody = (n) => n.type === 'EmptyStatement' || (n.type === 'BlockStatement' && n.body.every(isEmptyBody));

const isAssignLike = (n) => n.type === 'AssignmentExpression' || n.type === 'UpdateExpression';
const isConsoleCall = (n) => {
  if (!isCall(n) || !isMember(n.callee)) return false;
  const root = rootOf(n.callee);
  return root.type === 'Identifier' && root.name === 'console';
};

function highlight(tokens, base, out) {
  for (const tok of tokens || []) {
    const type = tok.type;
    let cls = null;
    if (type === 'CommentLine' || type === 'CommentBlock') cls = 'com';
    else {
      const label = typeof type === 'string' ? type : type.label;
      const keyword = typeof type === 'object' && type.keyword;
      if (label === 'string' || label === 'template' || label === '`' || label === 'regexp') cls = 'str';
      else if (label === 'num' || label === 'bigint') cls = 'num';
      else if (keyword) cls = ATOMS.has(keyword) ? 'atom' : 'kw';
      else if (label === 'name' && KEYWORD_NAMES.has(tok.value)) cls = 'kw';
      else if (label === 'name' && ATOMS.has(tok.value)) cls = 'atom';
    }
    if (cls) out.push([base + tok.start, base + tok.end, cls]);
  }
}

// results: rapportera värdet av uttryckssatser på toppnivå (skrivblocket)
export function instrument(code, { fileId, mode = 'module', baseOffset = 0, meta = newMeta(), results = false }) {
  const ast = parse(code, {
    sourceType: mode === 'module' ? 'module' : 'script',
    tokens: true,
    allowReturnOutsideFunction: true,
  });
  highlight(ast.tokens, baseOffset, meta.hl);

  const src = (n) => {
    const s = code.slice(n.start, n.end);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  };
  const kv = (name, ...args) =>
    t.callExpression(t.memberExpression(t.identifier('__kv'), t.identifier(name)), args);
  const top = () => t.unaryExpression('-', t.numericLiteral(fileId));

  const fnIndex = new WeakMap(); // funktionsnod -> index i meta.fns
  const stmtLoc = new WeakMap(); // satsnod -> index i meta.locs
  const origExpr = new WeakMap();
  const stepped = new WeakSet();
  const wrapped = new WeakSet();
  const logged = new WeakSet();
  const pendingRefs = [];

  const inParams = (path) => !!path.find((p) => p.listKey === 'params' && p.parentPath && p.parentPath.isFunction());

  const depthOf = (fnPath) => {
    let d = 0;
    for (let p = fnPath; p; p = p.parentPath) if (p.isFunction()) d++;
    return d;
  };
  // Varje funktion sparar sitt ram-id i en egen konstant: __kvs1, __kvs2 ... efter hur djupt den ligger.
  const frameVar = (fnPath) => (fnPath ? t.identifier('__kvs' + depthOf(fnPath)) : top());
  const currentFrame = (path) => frameVar(path.findParent((p) => p.isFunction()));

  // Ramen där variabeln `name` bor (inte nödvändigtvis funktionen som kör just nu).
  const bindingFrame = (path, name) => {
    const b = path.scope.getBinding(name);
    if (!b) return t.numericLiteral(0);
    let p = b.scope.path;
    while (p && !p.isFunction()) p = p.parentPath;
    if (!p) return mode === 'module' ? top() : t.numericLiteral(0);
    return frameVar(p);
  };

  const logVar = (path, name, how = 'v') => kv(how, bindingFrame(path, name), t.stringLiteral(name), t.identifier(name));
  const logThis = (path) => {
    const fn = path.findParent((p) => p.isFunction() && !p.isArrowFunctionExpression());
    return fn && fnIndex.has(fn.node) ? kv('m', frameVar(fn), t.stringLiteral('this'), t.thisExpression()) : null;
  };

  // Vilka variabler ska visas om efter att `target` har ändrats?
  const logTargets = (path, target) => {
    if (isMember(target)) {
      const root = rootOf(target);
      if (root.type === 'ThisExpression') {
        const call = logThis(path);
        return call ? [call] : [];
      }
      if (root.type !== 'Identifier' || BUILTINS.has(root.name)) return [];
      const b = path.scope.getBinding(root.name);
      if (b && (b.kind === 'module' || b.kind === 'hoisted')) return [];
      if (!b && mode === 'module') return [];
      // 'm' = variabeln pekar på samma sak som förut, men innehållet kan ha ändrats
      return [logVar(path, root.name, 'm')];
    }
    return Object.keys(t.getBindingIdentifiers(target)).map((name) => logVar(path, name));
  };

  const locOf = (path) => {
    for (let p = path; p; p = p.parentPath) {
      const li = stmtLoc.get(p.node);
      if (li) return li;
    }
    return 0;
  };

  const noteAssign = (li, name, init) => {
    if (!li) return;
    (meta.assigns[li] ??= {})[name] = init ? { rhs: src(init), chain: chainOf(init) } : { rhs: null, chain: null };
  };

  const describeFn = (path) => {
    const n = path.node;
    const par = path.parentPath;
    let name = null;
    let short = null;
    let nameNode = null;

    if (n.id) {
      name = n.id.name;
      nameNode = n.id;
    } else if (path.isClassMethod() || path.isClassPrivateMethod() || path.isObjectMethod()) {
      const key = n.key.type === 'PrivateName' ? '#' + n.key.id.name : n.key.name ?? String(n.key.value ?? '?');
      nameNode = n.key;
      const cls = path.isObjectMethod() ? null : par.parentPath.node.id?.name;
      if (n.kind === 'constructor') {
        name = 'new ' + (cls ?? 'klass');
        short = cls;
      } else {
        name = cls ? cls + '.' + key : key;
        short = key;
      }
    } else if (par.isVariableDeclarator() && par.node.id.type === 'Identifier') {
      name = par.node.id.name;
      nameNode = par.node.id;
    } else if (par.isAssignmentExpression() && par.node.right === n) {
      name = src(par.node.left);
      short = name.split('.').pop();
      nameNode = par.node.left;
    } else if ((par.isObjectProperty() || par.isClassProperty()) && par.node.value === n && !par.node.computed) {
      name = par.node.key.name ?? String(par.node.key.value ?? '?');
      nameNode = par.node.key;
    } else if ((isCall(par.node) || par.node.type === 'NewExpression') && par.node.callee !== n) {
      const callee = par.node.callee;
      const calleeName = isMember(callee) && !callee.computed ? callee.property.name : callee.name;
      const first = par.node.arguments[0];
      const label = calleeName === 'addEventListener' && first?.type === 'StringLiteral' ? first.value : calleeName;
      return {
        name: 'callback (' + (label ?? '?') + ')',
        short: null,
        params: paramNames(n),
        s: baseOffset + n.start,
        e: baseOffset + n.end,
      };
    }

    const out = {
      name: name ?? '(namnlös funktion)',
      short: name ? short ?? name : null,
      params: paramNames(n),
      s: baseOffset + n.start,
      e: baseOffset + n.end,
    };
    if (nameNode && nameNode.start != null) {
      out.ns = baseOffset + nameNode.start;
      out.ne = baseOffset + nameNode.end;
    }
    return out;
  };

  const paramNames = (n) => n.params.flatMap((p) => Object.keys(t.getBindingIdentifiers(p)));

  traverse(ast, {
    Function: {
      enter(path) {
        const n = path.node;
        if (!n.loc || fnIndex.has(n) || inParams(path)) return;
        fnIndex.set(n, meta.fns.length);
        meta.fns.push(describeFn(path));
        // x => x * 2  blir  x => { return x * 2; }  så att det finns en sats att stega på
        if (n.body.type !== 'BlockStatement') {
          const ret = t.returnStatement(n.body);
          ret.loc = n.body.loc;
          ret.start = n.body.start;
          ret.end = n.body.end;
          n.body = t.blockStatement([ret]);
          if ('expression' in n) n.expression = false;
        }
      },
      exit(path) {
        const n = path.node;
        const idx = fnIndex.get(n);
        if (!idx || wrapped.has(n)) return;
        wrapped.add(n);

        const frame = frameVar(path);
        const pre = paramNames(n).map((name) =>
          t.expressionStatement(kv('v', t.cloneNode(frame), t.stringLiteral(name), t.identifier(name))),
        );
        const isMethod = (path.isClassMethod() || path.isClassPrivateMethod() || path.isObjectMethod()) && n.kind !== 'constructor';
        if (isMethod) {
          pre.push(t.expressionStatement(kv('v', t.cloneNode(frame), t.stringLiteral('this'), t.thisExpression())));
        }

        const body = t.blockStatement(
          [
            t.variableDeclaration('const', [
              t.variableDeclarator(t.cloneNode(frame), kv('e', t.numericLiteral(fileId * MUL + idx), currentFrame(path))),
            ]),
            t.tryStatement(
              t.blockStatement([...pre, ...n.body.body]),
              t.catchClause(
                t.identifier('__kve'),
                t.blockStatement([t.throwStatement(kv('t', t.cloneNode(frame), t.identifier('__kve')))]),
              ),
              t.blockStatement([t.expressionStatement(kv('x', t.cloneNode(frame)))]),
            ),
          ],
          n.body.directives,
        );
        n.body = body;
      },
    },

    Statement: {
      enter(path) {
        const n = path.node;
        if (!n.loc || stepped.has(n) || inParams(path)) return;
        switch (n.type) {
          case 'BlockStatement':
          case 'FunctionDeclaration':
          case 'ImportDeclaration':
          case 'EmptyStatement':
          case 'ExportAllDeclaration':
            return;
          case 'ExportNamedDeclaration':
          case 'ExportDefaultDeclaration':
            if (!n.declaration || n.declaration.type === 'FunctionDeclaration') return;
        }
        if (!Array.isArray(path.container)) {
          // if (x) gör(); har ingen plats för ett extra anrop, så satsen får ett eget block
          const par = path.parentPath;
          const key = path.key;
          const ok =
            (par.isIfStatement() && (key === 'consequent' || key === 'alternate')) ||
            ((par.isLoop() || par.isWithStatement()) && key === 'body');
          if (ok) path.replaceWith(t.blockStatement([n]));
          return;
        }
        stepped.add(n);
        const li = meta.locs.length;
        meta.locs.push([baseOffset + n.start, baseOffset + n.end]);
        stmtLoc.set(n, li);
        path.insertBefore(t.expressionStatement(kv('s', currentFrame(path), t.numericLiteral(fileId * MUL + li))));
      },
    },

    VariableDeclarator(path) {
      const n = path.node;
      if (!n.loc || inParams(path) || n.id.type !== 'Identifier') return;
      noteAssign(locOf(path), n.id.name, n.init);
    },

    VariableDeclaration: {
      exit(path) {
        const n = path.node;
        if (!n.loc || logged.has(n) || inParams(path)) return;
        logged.add(n);
        let target = path;
        if (path.parentPath.isExportNamedDeclaration()) target = path.parentPath;
        else if (!Array.isArray(path.container)) return; // for (let i ...) sköts av Loop nedan
        const calls = [];
        for (const d of n.declarations) {
          if (!d.init && n.kind === 'var') continue;
          for (const name of Object.keys(t.getBindingIdentifiers(d.id))) calls.push(logVar(path, name));
        }
        if (calls.length) target.insertAfter(calls.map((c) => t.expressionStatement(c)));
      },
    },

    Loop: {
      exit(path) {
        const n = path.node;
        if (!n.loc || logged.has(n) || inParams(path)) return;
        logged.add(n);
        // En tom loop (while (x) {}) har inga satser som räknas, så spärren mot oändliga
        // loopar skulle aldrig slå till. Varje varv blir i stället ett steg på loopens rad.
        if (isEmptyBody(n.body) && stmtLoc.has(n)) {
          const L = t.numericLiteral(fileId * MUL + stmtLoc.get(n));
          n.body = t.blockStatement([t.expressionStatement(kv('s', currentFrame(path), L))]);
        }
        const head = n.type === 'ForStatement' ? n.init : n.left;
        if (!head) return;
        const names =
          head.type === 'VariableDeclaration'
            ? head.declarations.flatMap((d) => Object.keys(t.getBindingIdentifiers(d.id)))
            : head.type === 'Identifier'
              ? [head.name]
              : [];
        if (!names.length) return;
        if (n.body.type !== 'BlockStatement') n.body = t.blockStatement([n.body]);
        n.body.body.unshift(...names.map((name) => t.expressionStatement(logVar(path, name))));
      },
    },

    AssignmentExpression: {
      enter(path) {
        const n = path.node;
        if (n.loc && !inParams(path) && n.left.type === 'Identifier') noteAssign(locOf(path), n.left.name, n.right);
      },
      exit(path) {
        const n = path.node;
        if (!n.loc || logged.has(n) || inParams(path)) return;
        logged.add(n);
        const calls = logTargets(path, n.left);
        if (calls.length) path.replaceWith(kv('q', n, ...calls));
      },
    },

    UpdateExpression: {
      exit(path) {
        const n = path.node;
        if (!n.loc || logged.has(n) || inParams(path)) return;
        logged.add(n);
        const calls = logTargets(path, n.argument);
        if (calls.length) path.replaceWith(kv('q', n, ...calls));
      },
    },

    ExpressionStatement: {
      enter(path) {
        origExpr.set(path.node, path.node.expression);
      },
      // lista.push(x) ändrar lista utan något =, så variabeln visas om efteråt
      exit(path) {
        const n = path.node;
        if (!n.loc || logged.has(n) || inParams(path) || !Array.isArray(path.container)) return;
        logged.add(n);
        let e = origExpr.get(n);
        if (e && e.type === 'AwaitExpression') e = e.argument;
        // Skrivblocket: `tal.map(...)` på en egen rad visar sitt värde, som i konsolen.
        // Tilldelningar syns redan som variabler, och console.log syns i konsolen.
        if (results && e && path.parentPath.isProgram() && stmtLoc.has(n) && !isAssignLike(e) && !isConsoleCall(e)) {
          const quiet = isCall(e) || e.type === 'NewExpression'; // anrop som ger undefined är inte värda att visa
          const L = t.numericLiteral(fileId * MUL + stmtLoc.get(n));
          n.expression = quiet ? kv('o', currentFrame(path), n.expression, L, t.numericLiteral(1)) : kv('o', currentFrame(path), n.expression, L);
        }
        if (!isCall(e) || !isMember(e.callee)) return;
        const calls = logTargets(path, e.callee);
        if (calls.length) path.insertAfter(calls.map((c) => t.expressionStatement(c)));
      },
    },

    ReturnStatement: {
      enter(path) {
        const n = path.node;
        if (n.loc && n.argument) origExpr.set(n, n.argument);
      },
      exit(path) {
        const n = path.node;
        if (!n.loc || !n.argument || logged.has(n) || inParams(path)) return;
        logged.add(n);
        noteAssign(locOf(path), 'return', origExpr.get(n));
        const fn = path.findParent((p) => p.isFunction());
        if (fn && fnIndex.has(fn.node)) n.argument = kv('r', frameVar(fn), n.argument);
      },
    },

    AwaitExpression: {
      exit(path) {
        const n = path.node;
        if (!n.loc || logged.has(n) || inParams(path)) return;
        logged.add(n);
        const frame = currentFrame(path);
        path.replaceWith(kv('ar', frame, t.awaitExpression(kv('aw', t.cloneNode(frame), n.argument))));
      },
    },

    'MemberExpression|OptionalMemberExpression'(path) {
      const n = path.node;
      if (!n.loc || inParams(path)) return;
      const li = locOf(path);
      if (!li) return;
      const list = (meta.members[li] ??= []);
      if (list.length >= 12) return;
      const prop = !n.computed && n.property.type === 'Identifier' ? n.property.name : src(n.property);
      list.push({ src: src(n.object), chain: chainOf(n.object), prop });
    },

    'CallExpression|OptionalCallExpression|NewExpression'(path) {
      const n = path.node;
      if (!n.loc || inParams(path)) return;
      const callee = n.callee;
      const li = locOf(path);
      if (li) {
        const list = (meta.calls[li] ??= []);
        if (list.length < 12) list.push({ src: src(callee), chain: chainOf(callee) });
      }
      if (isMember(callee) && !callee.computed && callee.property.type === 'Identifier') {
        meta.refs.push({ s: baseOffset + callee.property.start, e: baseOffset + callee.property.end, name: callee.property.name });
      }
    },

    Identifier(path) {
      const n = path.node;
      if (!n.loc || !path.isReferencedIdentifier()) return;
      const ref = { s: baseOffset + n.start, e: baseOffset + n.end, name: n.name };
      const b = path.scope.getBinding(n.name);
      if (!b) {
        const par = path.parent;
        if ((isCall(par) || par.type === 'NewExpression') && par.callee === n) meta.refs.push(ref);
      } else if (b.kind === 'module') {
        ref.name = b.path.node.imported?.name ?? n.name;
        meta.refs.push(ref);
      } else {
        pendingRefs.push({ ref, node: b.path.node });
      }
    },
  });

  // Koppla ihop varje referens med funktionen den pekar på (nu när alla funktioner har fått nummer)
  for (const { ref, node } of pendingRefs) {
    let fn = null;
    if (t.isFunction(node)) fn = node;
    else if (node.type === 'VariableDeclarator' && t.isFunction(node.init)) fn = node.init;
    else if (node.type === 'ClassDeclaration') {
      meta.refs.push(ref);
      continue;
    }
    const idx = fn && fnIndex.get(fn);
    if (idx) meta.refs.push({ ...ref, fn: idx });
  }

  const out = generate(ast, { retainLines: true, comments: true });
  return { code: out.code, meta };
}
