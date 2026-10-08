/* ── How the site is used (anonymous) ─────────────────────
   Counts, for each page view: how long the page was actively read, how far
   down it was scrolled, how long each part was read (a section of a page, or
   a step of the online forms, which say which step they are on through
   window.mpmbUsage), the links followed, and which fields a form asked to be
   fixed. Sent to the study's own server (the usage function in
   consent-app/firebase/functions/src/usage.ts), so the team can see where
   people get stuck.

   No cookies, nothing stored on the device (except "don't count my visits",
   if someone chooses it on the privacy page), no IP address kept, no names,
   answers, participant IDs or reference codes: links and the page address
   are cut down to a few known switches first. Nothing is sent from browsers
   that ask sites not to track them, or from anywhere but the live site. */
(() => {
  const OFF_KEY = 'mpmb-usage';
  const LIVE = ['https://myphonemybrain.com', 'https://www.myphonemybrain.com'];
  const QUERY = { who: /^(parent|young)$/, school: /^[a-z0-9-]{1,30}$/, optout: /^1$/, flow: /^[a-z]{1,12}$/, phase: /^(pre|mid|post)$/, step: /^guide$/, at: /^lab$/, for: /^young$/ };
  const script = document.currentScript;
  const endpoint = window.MPMB_USAGE_ENDPOINT || (LIVE.includes(window.location.origin) && script && script.dataset.endpoint) || '';
  const browserSaysNo = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  const chosenOff = () => {
    try {
      return window.localStorage.getItem(OFF_KEY) === 'off';
    } catch {
      return false;
    }
  };

  /* The privacy page's "Don't count my visits" switch works even when nothing is being counted. */
  const showChoice = () => {
    document.querySelectorAll('[data-usage-status]').forEach((el) => {
      el.textContent = browserSaysNo
        ? 'Your browser asks websites not to track it, so your visits are not counted.'
        : chosenOff()
          ? 'Your visits are not counted on this browser.'
          : 'Your visits are counted, anonymously.';
    });
    document.querySelectorAll('[data-usage-toggle]').forEach((el) => {
      el.hidden = browserSaysNo;
      el.textContent = chosenOff() ? 'Count my visits again' : 'Don’t count my visits';
    });
  };
  document.addEventListener('click', (e) => {
    const toggle = e.target instanceof Element ? e.target.closest('[data-usage-toggle]') : null;
    if (!toggle) return;
    try {
      if (chosenOff()) window.localStorage.removeItem(OFF_KEY);
      else window.localStorage.setItem(OFF_KEY, 'off');
    } catch {
      /* storage blocked: nothing to remember the choice with */
    }
    showChoice();
  });
  showChoice();

  const noop = { part() {}, app() {}, variant() {}, event() {} };
  const queued = Array.isArray(window.mpmbUsageQueue) ? window.mpmbUsageQueue : [];
  window.mpmbUsageQueue = [];
  if (!endpoint || browserSaysNo || chosenOff() || !window.crypto || !window.crypto.getRandomValues) {
    window.mpmbUsage = noop;
    return;
  }

  const clean = (s, max) => String(s).replace(/[^A-Za-z0-9\-_/.]/g, '-').slice(0, max);
  const host = (h) => `ext:${String(h).toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 100)}`;
  const partName = (s) => String(s).replace(/[^A-Za-z0-9>:_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'part';
  const queryOf = (search) => {
    const out = {};
    const params = new URLSearchParams(search);
    Object.keys(QUERY).forEach((k) => {
      const v = params.get(k);
      if (v !== null && QUERY[k].test(v)) out[k] = v;
    });
    // "Finish with your reference" links carry the reference itself: only that it was one is kept.
    if (params.has('finish')) out.finish = 'yes';
    return out;
  };
  const linkOf = (a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('mailto:')) return 'mailto';
    if (href.startsWith('tel:')) return 'tel';
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return null;
    }
    if (url.origin !== window.location.origin) return /^https?:$/.test(url.protocol) && url.hostname ? host(url.hostname) : null;
    const q = new URLSearchParams(queryOf(url.search)).toString().slice(0, 80);
    const hash = url.hash.length > 1 ? `#${url.hash.slice(1).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60)}` : '';
    // A jump within this page is just its #section.
    if (url.pathname === window.location.pathname && url.search === window.location.search && hash) return hash;
    return `${clean(url.pathname, 120)}${q ? `?${q}` : ''}${hash}`;
  };

  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  const view = Array.from(bytes, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
  const width = window.innerWidth || document.documentElement.clientWidth;
  const device = width < 640 ? 'phone' : width < 1024 ? 'tablet' : 'computer';
  const started = Date.now();
  let ref = '';
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    if (r) ref = r.origin === window.location.origin ? clean(r.pathname, 120) : /^https?:$/.test(r.protocol) && r.hostname ? host(r.hostname) : '';
  } catch {
    ref = '';
  }

  const state = { app: null, variant: null, explicit: null, active: 0, scroll: 0, parts: {}, order: [], events: [], seq: 0, changed: true };
  let lastInput = Date.now();

  /* The sections of a page: its h2 headings outside the forms, named after the nearest id. */
  const headings = Array.from(document.querySelectorAll('main h2')).filter((h) => !h.closest('.mpmb-app-mount'));
  const sectionName = (h) => partName(h.id || (h.closest('[id]:not(main)') || {}).id || h.textContent.trim().toLowerCase());
  const currentPart = () => {
    if (state.explicit) return state.explicit;
    const line = window.innerHeight * 0.35;
    let name = 'top';
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= line) name = sectionName(h);
      else break;
    }
    return name;
  };
  const enter = (name) => {
    if (!state.order.includes(name) && state.order.length < 80 && Object.keys(state.parts).length < 60) {
      state.order.push(name);
      state.parts[name] = state.parts[name] || 0;
      state.changed = true;
    }
  };
  const addEvent = (e) => {
    if (state.events.length < 50) state.events.push({ t: Math.min(86400, Math.round((Date.now() - started) / 100) / 10), part: currentPart(), ...e });
    state.changed = true;
  };

  const measureScroll = () => {
    const doc = document.documentElement;
    const seen = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / Math.max(doc.scrollHeight, 1)) * 100));
    if (seen > state.scroll) {
      state.scroll = seen;
      state.changed = true;
    }
  };

  ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove'].forEach((type) =>
    window.addEventListener(type, () => {
      lastInput = Date.now();
      if (type === 'scroll') measureScroll();
    }, { passive: true }),
  );

  /* A second counts if the page is on screen and has been used in the last minute. */
  window.setInterval(() => {
    if (document.visibilityState !== 'visible' || Date.now() - lastInput > 60000) return;
    const part = currentPart();
    enter(part);
    state.active += 1;
    if (part in state.parts) state.parts[part] += 1;
    state.changed = true;
  }, 1000);

  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || a.closest('.mpmb-app-mount')) return;
    const to = linkOf(a);
    if (to) addEvent({ type: 'click', to, label: a.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) });
  }, true);

  const send = (final) => {
    // Turned off on the privacy page while this page was open: stop at once.
    if ((!state.changed && !final) || chosenOff()) return;
    const body = JSON.stringify({
      v: 1,
      view,
      seq: state.seq,
      final,
      page: clean(window.location.pathname, 120),
      query: queryOf(window.location.search),
      ref,
      device,
      app: state.app,
      variant: state.variant,
      active: state.active,
      scroll: state.scroll,
      parts: state.parts,
      order: state.order,
      events: state.events,
    });
    state.seq += 1;
    state.events = [];
    state.changed = false;
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, blob))) {
      window.fetch(endpoint, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    }
  };

  window.setTimeout(() => send(false), 5000);
  window.setInterval(() => send(false), 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send(false);
  });
  window.addEventListener('pagehide', () => send(true));

  /* For the forms: which app, which way through it, which step, and what went wrong. */
  window.mpmbUsage = {
    app(name) {
      if (name === 'family' || name === 'break') state.app = name;
    },
    variant(name) {
      if (typeof name === 'string' && /^[a-z-]{1,20}$/.test(name)) state.variant = name;
    },
    part(name) {
      state.explicit = partName(name);
      enter(state.explicit);
      lastInput = Date.now();
    },
    event(type, data) {
      if (type === 'errors' && data && Array.isArray(data.fields)) {
        const fields = data.fields.filter((f) => typeof f === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(f)).slice(0, 20);
        if (fields.length) addEvent({ type: 'errors', fields });
      } else if (type === 'save-failed') addEvent({ type: 'save-failed' });
    },
  };
  queued.forEach(([method, ...args]) => {
    if (typeof window.mpmbUsage[method] === 'function') window.mpmbUsage[method](...args);
  });
  measureScroll();
})();
