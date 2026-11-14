// STUB — replaced by the audio programmer
// Silent implementation of the full R.Audio contract so every caller is safe.
(function (R) {
  'use strict';

  function noop() {}

  R.Audio = {
    ready: false,
    muted: false,
    init: function () { R.Audio.ready = true; },
    setMuted: function (b) { R.Audio.muted = !!b; },
    suspend: noop,
    resume: noop,
    sfx: noop,          // (name, opts?)  opts: { vol, pitch }
    music: noop,        // (name|null, fadeSec = 1)
    heartbeat: noop     // (bpm|0)
  };
})(globalThis.RIVAL = globalThis.RIVAL || {});
