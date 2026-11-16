// SHOW ME MY RIVAL - persistence. Never throws; falls back to memory when storage is missing or hostile.
(function (R) {
  'use strict';

  var KEY = 'rival.save.v1';
  // The save's generation: a decimal integer string, bumped after every successful save write. A tab that finds a
  // generation it did not read or write itself is stale (another tab saved since): it writes nothing from then on.
  var GEN_KEY = 'rival.save.v1.gen';
  var store = null;      // storage-like object or null
  var mem = null;        // last serialized save (in-memory fallback, also used if setItem throws)
  var myGen = 0;         // the generation this tab last read or wrote

  function defaults() {
    return {
      v: 1,
      settings: { muted: false, haptics: true, mask: 'porcelain', arena: 'cathedral' },
      brain: null,
      meta: null,
      run: null
    };
  }

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

  // Returns a well-formed save built from whatever was stored. Unknown extra fields are kept.
  function repair(raw) {
    var d = defaults(), s, k;
    if (!isObj(raw)) return d;
    for (k in raw) if (Object.prototype.hasOwnProperty.call(raw, k) && !(k in d)) d[k] = raw[k];
    if (isObj(raw.settings)) {
      s = raw.settings;
      for (k in s) if (Object.prototype.hasOwnProperty.call(s, k) && !(k in d.settings)) d.settings[k] = s[k];
      if (typeof s.muted === 'boolean') d.settings.muted = s.muted;
      if (typeof s.haptics === 'boolean') d.settings.haptics = s.haptics;
      if (typeof s.mask === 'string' && s.mask) d.settings.mask = s.mask;
      if (typeof s.arena === 'string' && s.arena) d.settings.arena = s.arena;
    }
    d.brain = isObj(raw.brain) ? raw.brain : null;
    d.meta = isObj(raw.meta) ? raw.meta : null;
    // A meta from an older shape (no .memory / .counters / .unlocked) must not reach the scenes, which read
    // meta.memory directly. R.Run owns the schema and fills in whatever is missing (it is loaded by init() time).
    if (d.meta && R.Run && typeof R.Run.repairMeta === 'function') {
      try { d.meta = R.Run.repairMeta(d.meta); } catch (e) { d.meta = null; }
    }
    d.run = isObj(raw.run) ? raw.run : null;
    d.v = 1;
    return d;
  }

  // Generations are written as plain decimal integers below GEN_WRAP (after GEN_WRAP - 1 comes 1), so every one this
  // code writes reads back as the same number.
  var GEN_WRAP = 1e9;
  // The stored generation: an integer (0 when missing or garbage, including a value too long to be one this code
  // wrote), or null when storage cannot be read.
  function readGen() {
    var g;
    try { g = store.getItem(GEN_KEY); } catch (e) { return null; }
    return typeof g === 'string' && /^\d{1,9}$/.test(g) ? +g : 0;
  }
  // false (and stale from then on) when another tab saved since this one last read or wrote. No storage, or a
  // generation that cannot be read, is memory-only, never stale.
  function fresh() {
    if (Save.stale) return false;
    if (!store) return true;
    var g = readGen();
    if (g !== null && g !== myGen) { Save.stale = true; return false; }
    return true;
  }

  var Save = {
    KEY: KEY,
    GEN_KEY: GEN_KEY,
    data: defaults(),
    persistent: false,          // true once a real storage read or write has succeeded
    stale: false,               // another tab saved after this one loaded: nothing is written until a reload

    init: function (storageLike) {
      var txt = null;
      store = null;
      myGen = 0;
      Save.persistent = false;
      Save.stale = false;
      try {
        if (storageLike && typeof storageLike.getItem === 'function' && typeof storageLike.setItem === 'function') {
          store = storageLike;
          txt = store.getItem(KEY);
          Save.persistent = true;
        }
      } catch (e) { store = null; Save.persistent = false; }
      if (store) myGen = readGen() || 0;
      // The in-memory copy stands in only for storage that cannot be read. Storage that was read and holds no save
      // (cleared by another tab or by hand) is believed: a stale tab that reboots must not bring its own copy back.
      if (txt == null && !store) txt = mem;
      var raw = null;
      try { if (typeof txt === 'string' && txt) raw = JSON.parse(txt); } catch (e2) { raw = null; }
      Save.data = repair(raw);
      return Save.data;
    },

    // Re-reads the generation: true when this tab is (now) stale. Never writes.
    check: function () { return !fresh(); },
    // Another tab wrote the save (a storage event): stale, unless this tab has no storage to share.
    changedElsewhere: function () { if (store) Save.stale = true; },

    commit: function () {
      var txt, cur, next;
      if (!fresh()) return false;                                            // a newer save from another tab: keep it
      try { txt = JSON.stringify(Save.data); } catch (e) { return false; }   // cyclic data: keep the previous save
      if (typeof txt !== 'string') return false;
      mem = txt;
      if (!store) return false;
      // Storage already holds exactly this save: nothing is written and no new generation is taken, so a tab that
      // saves with nothing new (an idle second tab hidden or closed) never makes another tab stale.
      try { cur = store.getItem(KEY); } catch (e1) { cur = null; }
      if (cur === txt) return true;
      try { store.setItem(KEY, txt); Save.persistent = true; }
      catch (e2) { Save.persistent = false; return false; }                  // quota / private mode: memory only
      next = myGen + 1 < GEN_WRAP ? myGen + 1 : 1;
      try { store.setItem(GEN_KEY, String(next)); myGen = next; } catch (e3) { /* the save is written; the generation stays */ }
      return true;
    },

    reset: function () {
      if (!fresh()) return Save.data;                                        // never erase another tab's newer save
      Save.data = defaults();
      mem = null;
      try { if (store && typeof store.removeItem === 'function') store.removeItem(KEY); } catch (e) { /* ignore */ }
      Save.commit();
      return Save.data;
    }
  };

  R.Save = Save;
})(globalThis.RIVAL = globalThis.RIVAL || {});
