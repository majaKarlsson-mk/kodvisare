// Lyssnar på allt som startar kod "senare": klick, timers, fetch och promises.
// Varje gång webbläsaren kör en callback berättar vi för spåraren varför,
// så att tidslinjen kan visa "klick på <button#sok>" eller "svar 200 från ...".
(function (G) {
  const kv = G.__kv;
  if (!kv || kv.hooked || typeof G.window === 'undefined') return;
  kv.hooked = true;

  const el = G.__kvSnap.el;

  function targetName(t) {
    if (t === G) return 'window';
    try {
      if (t && typeof t.nodeType === 'number') return el(t);
    } catch {}
    return (t && t.constructor && t.constructor.name) || 'objekt';
  }

  function shortUrl(input) {
    let url = String(input && input.url ? input.url : input);
    try {
      const u = new URL(url, G.location.href);
      url = u.origin === G.location.origin ? u.pathname + u.search : u.host + u.pathname;
    } catch {}
    return url.length > 60 ? url.slice(0, 57) + '…' : url;
  }

  // Fel som ingen fångar
  G.addEventListener('error', (ev) => {
    kv.uncaught(ev.error != null ? ev.error : ev.message, { file: ev.filename, line: ev.lineno });
    kv.flush();
  });
  G.addEventListener('unhandledrejection', (ev) => {
    kv.uncaught(ev.reason, null);
    kv.flush();
  });

  // Events (klick, input, submit ...)
  const add = G.EventTarget.prototype.addEventListener;
  const remove = G.EventTarget.prototype.removeEventListener;
  const wrapped = new WeakMap();

  G.EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!listener || (typeof listener !== 'function' && typeof listener.handleEvent !== 'function')) {
      return add.call(this, type, listener, options);
    }
    let w = wrapped.get(listener);
    if (!w) {
      const origin = kv.now() - 1;
      w = function (ev) {
        kv.job('event', (ev && ev.type) + ' på ' + targetName(ev && ev.currentTarget), origin);
        return typeof listener === 'function' ? listener.call(this, ev) : listener.handleEvent(ev);
      };
      wrapped.set(listener, w);
    }
    return add.call(this, type, w, options);
  };

  G.EventTarget.prototype.removeEventListener = function (type, listener, options) {
    return remove.call(this, type, (listener && wrapped.get(listener)) || listener, options);
  };

  // Timers
  function wrapTimer(name, label) {
    const orig = G[name];
    if (typeof orig !== 'function') return;
    G[name] = function (fn, ms, ...rest) {
      if (typeof fn !== 'function') return orig.call(this, fn, ms, ...rest);
      const origin = kv.now() - 1;
      const text = label(ms);
      return orig.call(
        this,
        function (...args) {
          kv.job('timer', text, origin);
          return fn.apply(this, args);
        },
        ms,
        ...rest,
      );
    };
  }
  wrapTimer('setTimeout', (ms) => 'setTimeout (' + (Number(ms) || 0) + ' ms)');
  wrapTimer('setInterval', (ms) => 'setInterval (' + (Number(ms) || 0) + ' ms)');
  wrapTimer('requestAnimationFrame', () => 'requestAnimationFrame');

  // fetch
  if (typeof G.fetch === 'function') {
    const origFetch = G.fetch;
    G.fetch = function (input, init) {
      const url = shortUrl(input);
      const origin = kv.mark('fetch', 'fetch skickas: ' + url, kv.now() - 1);
      return origFetch.call(this, input, init).then(
        (res) => {
          kv.mark('response', 'svar ' + res.status + ' från ' + url, origin);
          return res;
        },
        (err) => {
          kv.mark('response', 'fetch misslyckades: ' + url, origin);
          throw err;
        },
      );
    };
  }

  // .then/.catch-callbacks ska inte se ut som om de anropades av koden som råkade köra sist
  const origThen = G.Promise.prototype.then;
  const fresh = (cb) =>
    typeof cb === 'function'
      ? function (value) {
          kv.fresh();
          return cb(value);
        }
      : cb;
  G.Promise.prototype.then = function (onOk, onFail) {
    return origThen.call(this, fresh(onOk), fresh(onFail));
  };

  // console
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = G.console[level];
    G.console[level] = function (...args) {
      kv.log(level, args);
      return orig.apply(this, args);
    };
  }
})(globalThis);
