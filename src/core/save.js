// SHOW ME MY RIVAL - persistence. Never throws; falls back to memory when storage is missing or hostile.
(function (R) {
  'use strict';

  var KEY = 'rival.save.v1';
  var store = null;      // storage-like object or null
  var mem = null;        // last serialized save (in-memory fallback, also used if setItem throws)

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

  var Save = {
    KEY: KEY,
    data: defaults(),
    persistent: false,          // true once a real storage read or write has succeeded

    init: function (storageLike) {
      var txt = null;
      store = null;
      Save.persistent = false;
      try {
        if (storageLike && typeof storageLike.getItem === 'function' && typeof storageLike.setItem === 'function') {
          store = storageLike;
          txt = store.getItem(KEY);
          Save.persistent = true;
        }
      } catch (e) { store = null; Save.persistent = false; }
      if (txt == null) txt = mem;
      var raw = null;
      try { if (typeof txt === 'string' && txt) raw = JSON.parse(txt); } catch (e2) { raw = null; }
      Save.data = repair(raw);
      return Save.data;
    },

    commit: function () {
      var txt;
      try { txt = JSON.stringify(Save.data); } catch (e) { return false; }   // cyclic data: keep the previous save
      if (typeof txt !== 'string') return false;
      mem = txt;
      if (!store) return false;
      try { store.setItem(KEY, txt); Save.persistent = true; return true; }
      catch (e2) { Save.persistent = false; return false; }                  // quota / private mode: memory only
    },

    reset: function () {
      Save.data = defaults();
      mem = null;
      try { if (store && typeof store.removeItem === 'function') store.removeItem(KEY); } catch (e) { /* ignore */ }
      Save.commit();
      return Save.data;
    }
  };

  R.Save = Save;
})(globalThis.RIVAL = globalThis.RIVAL || {});
