// ---- dictation: what you say, written into the box you type in
//
// The mic button of a box (a session's, the new-session bar's): hold it while
// you speak, or tap it to talk and tap again when you're done. The words come
// into the box as you talk, after what's typed there, to send from there.
// Three ways to write them down, the first one there is unless Settings picks
// one (per device: dictationWay):
//
//   host:   the host writes it down ("dictation on the host" in amarchy: a
//           speech model there that tells Spanish from English by itself).
//           The phone's microphone as Claude's voice mode gets it (micOpen),
//           on a WebSocket to /api/dictate.
//   device: the browser's own speech recognition (Web Speech: Apple's in
//           Safari, Google's in Chrome), in one language you pick. Not in
//           the home-screen app on an iPhone, where WebKit's misses words or
//           never answers.
//   claude: Claude Code's own voice mode, in a session's terminal Claude (or
//           the new session it starts): SessionView.dictate and newBar's talk,
//           handed in as opts.claude.

const DICTATE_TAP = 350;      // ms: let go sooner and it's a tap: it listens until tapped again
const DICTATE_STOP = 6000;    // ms the browser's recognition may take to finish once stopped
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const iPhoneApp = standaloneApple();

function standaloneApple() {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return apple && (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
}

function dictationHost() {
  return !!(app.view && app.view.dictation && app.view.dictation.ready);
}

// The way this device writes dictation down: host, device, claude, or null
// (no mic button). claude: Claude's voice mode would do (a session's).
function dictationWay(claude) {
  const ok = { host: dictationHost(), device: !!SpeechRec, claude: !!(claude && app.view && app.view.voice) };
  const pick = store.get("dictation");
  if (ok[pick]) return pick;
  if (ok.host) return "host";
  if (ok.device && !iPhoneApp) return "device";
  if (ok.claude) return "claude";
  return ok.device ? "device" : null;
}

function dictationLang() {
  return store.get("dictation-lang") || navigator.language || "en-US";
}

function dictationStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

// What the browser's recognition did, for amarchy dictation log on the host.
function dictationReport(entry) {
  api("/api/dictate/log", { ...entry, standalone: dictationStandalone() }).catch(() => {});
}

// opts: field (the textarea), button (its mic), changed() after the words
// change, state(text) for what's going on (null: nothing), claude (the
// voice-mode way: { start(), stop() }, or nothing where it can't be).
class Dictate {
  constructor(opts) {
    this.opts = opts;
    this.run = null;          // the dictation under way
    this.locked = false;      // tapped: listening until tapped again
    const el = opts.button;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.locked) {      // tapped again: done
        this.locked = false;
        this.stop();
        return;
      }
      if (this.run) return;     // still writing the last one down
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      this.down = e.timeStamp;      // when it was touched, however long starting takes
      this.start();
    });
    for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) {
      el.addEventListener(end, (e) => {
        if (this.down === null || this.down === undefined) return;
        const tapped = e.timeStamp - this.down < DICTATE_TAP;
        this.down = null;
        if (tapped && end === "pointerup" && this.run && this.run.held) {
          this.locked = true;
          this.say(this.run && this.run.way === "claude" ? null : "Listening… tap the mic when you're done");
          el.classList.add("on");
          return;
        }
        this.stop();
      });
    }
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Claude's voice mode is the TUI's: not on the chat engine (claude.off).
  way() { return dictationWay(!!this.opts.claude && !(this.opts.claude.off && this.opts.claude.off())); }

  on() { return !!this.run; }

  available() { return !!this.way(); }

  start() {
    if (this.run) return;
    const way = this.way();
    if (!way) return;
    const field = this.opts.field;
    const base = field.value.replace(/\s+$/, "");
    const r = this.run = { way, base, first: base, held: true, words: "", wrote: false, started: Date.now() };
    this.opts.button.classList.add("on");
    if (way === "claude") return this.opts.claude.start();
    if (this.opts.changed) this.opts.changed();
    if (way === "host") this.host(r);
    else this.device(r);
  }

  stop() {
    const r = this.run;
    if (!r || !r.held) return;
    r.held = false;
    this.locked = false;
    this.opts.button.classList.remove("on");
    if (r.way === "claude") {
      this.run = null;
      return this.opts.claude.stop();
    }
    r.letGo = Date.now();
    if (r.stop) r.stop();
  }

  // Leaving the box (the session closed): what's under way is dropped.
  cancel() {
    const r = this.run;
    if (!r) return;
    this.locked = false;
    if (r.way === "claude") {
      this.stop();
      return;
    }
    r.held = false;
    r.cancelled = true;
    if (r.cancel) r.cancel();
    this.done(r);
  }

  write(r, words) {
    if (r.cancelled || this.run !== r) return;
    r.words = words;
    r.wrote = r.wrote || !!words;
    const field = this.opts.field;
    field.value = r.base && words ? `${r.base} ${words}` : r.base || words;
    if (this.opts.changed) this.opts.changed();
  }

  say(text) {
    if (this.opts.state) this.opts.state(text);
  }

  done(r) {
    if (this.run !== r) return;
    this.run = null;
    this.locked = false;
    this.opts.button.classList.remove("on");
    this.say(null);
    if (this.opts.changed) this.opts.changed();
  }

  // ---- written down on the host
  async host(r) {
    this.say("Starting the microphone…");
    const queue = [];
    let ws = null;
    mic.hears = () => { if (r.held) this.say(this.locked ? "Listening… tap the mic when you're done" : "Listening…"); };
    try {
      await micOpen();
    } catch (e) {
      this.done(r);
      toast(e.name === "NotAllowedError" ? "Amarchy may not use the microphone: allow it in Settings"
                                        : `The microphone didn't start: ${e.message}`);
      return;
    }
    if (r.cancelled || this.run !== r) {
      micRelease();
      return;
    }
    mic.take = (pcm) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(pcm);
      else if (queue.length < 15000) queue.push(pcm);      // 5 minutes, as long as one can be
    };
    let ended = false, heard = false;
    const end = () => {
      if (ended || !ws || ws.readyState !== WebSocket.OPEN) return;
      ended = true;
      ws.send("end");
      this.say("Writing it down…");
    };
    r.stop = async () => {
      await new Promise((ok) => setTimeout(ok, MIC_TAIL));       // the end of the last word
      if (mic.take) micRelease();
      if (ws && ws.readyState === WebSocket.OPEN) end();
      else this.say("Writing it down…");
    };
    r.cancel = () => {
      if (mic.take) micRelease();
      if (ws) ws.close();
    };
    if (!r.held) r.stop();      // let go already (while the phone asked about the microphone)
    const url = `/api/dictate${dictationStandalone() ? "?standalone=1" : ""}`;
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      for (const pcm of queue) ws.send(pcm);
      queue.length = 0;
      if (!r.held && !mic.take) end();
    };
    ws.onmessage = (e) => {
      let d = {};
      try { d = JSON.parse(e.data); } catch (err) { return; }
      heard = true;
      if (d.state === "transcribing") this.say("Writing it down…");
      if (typeof d.interim === "string") this.write(r, d.interim);
      if (typeof d.text === "string") {
        this.write(r, d.text);
        this.done(r);
      }
      if (d.error) {
        this.write(r, "");
        this.done(r);
        toast(d.error);
      }
    };
    ws.onclose = async () => {
      if (r.held && mic.take) micRelease();       // gone while still listening
      r.held = false;
      const was = this.run === r;
      this.done(r);
      if (!heard && was && !r.cancelled) {        // it didn't take it: ask why
        try {
          const res = await fetch("/api/dictate", { headers: { Accept: "application/json" } });
          const d = await res.json();
          toast(d.ready ? "Dictation didn't connect" : `Dictation isn't set up on the host: ${d.how}`);
        } catch (err) {
          toast("Can't reach Amarchy");
        }
      }
    };
  }

  // ---- written down by the browser itself (Web Speech)
  device(r) {
    let rec;
    try {
      rec = new SpeechRec();
    } catch (e) {
      this.done(r);
      toast(`This browser's speech recognition didn't start: ${e.message}`);
      return;
    }
    const lang = rec.lang = dictationLang();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let error = null, finished = false, results = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(r.timer);
      const value = this.opts.field.value;
      const words = r.wrote && value.startsWith(r.first) ? value.slice(r.first.length).trim() : "";
      if (!r.cancelled) {
        if (!words) {
          this.write(r, "");
          toast(error ? deviceError(error) : "No words heard");
        }
        dictationReport({ lang, said_s: ((r.letGo || Date.now()) - r.started) / 1000,
                          wait_ms: r.letGo ? Date.now() - r.letGo : null, text: words,
                          error: error || (words ? null : results ? "no words" : "no answer from the browser") });
      }
      this.done(r);
    };
    rec.onstart = () => { if (!r.cancelled) this.say(this.locked ? "Listening… tap the mic when you're done" : "Listening…"); };
    // Each time, the whole of it again from what it has (adding to what came
    // before repeats words on iOS, which hands some of them in twice).
    rec.onresult = (e) => {
      results = true;
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      this.write(r, said.replace(/\s+/g, " ").trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" && r.held) return;      // a pause while you hold it: it goes on (onend)
      if (e.error !== "aborted" || !r.cancelled) error = error || e.error || "error";
    };
    rec.onend = () => {
      if (r.held && !error && !finished) {      // it stopped by itself (a pause, Chrome's limit): on again
        r.base = this.opts.field.value.replace(/\s+$/, "");
        r.words = "";
        try { rec.start(); return; } catch (err) { /* finish */ }
      }
      finish();
    };
    r.stop = () => {
      this.say("Writing it down…");
      setTimeout(() => {
        try { rec.stop(); } catch (err) { finish(); }
      }, MIC_TAIL);
      r.timer = setTimeout(() => { try { rec.abort(); } catch (err) { /* gone */ } finish(); }, MIC_TAIL + DICTATE_STOP);
    };
    r.cancel = () => { try { rec.abort(); } catch (err) { /* gone */ } };
    this.say("Starting the microphone…");
    try {
      rec.start();      // in the touch itself: iOS starts it only then
    } catch (e) {
      error = e.message || "didn't start";
      finish();
    }
  }
}

function deviceError(code) {
  return {
    "not-allowed": "Amarchy may not use the microphone or speech recognition: allow it in Settings",
    "service-not-allowed": "This browser's speech recognition isn't allowed here (on an iPhone: turn on Siri & Dictation, or use the host's)",
    "no-speech": "No words heard",
    "audio-capture": "No microphone was found",
    network: "This browser's speech recognition needs the internet",
    "language-not-supported": `It doesn't know ${dictationLang()}: pick another language in Settings`,
  }[code] || `This browser's speech recognition failed (${code})`;
}

// Settings → Dictation.
function dictationSettings(draw) {
  const d = (app.view && app.view.dictation) || {};
  const kids = [h("div", { class: "section" }, "Dictation")];
  const now = dictationWay(true);
  const ways = [["auto", "Automatic"]];
  if (d.ready) ways.push(["host", "On the host"]);
  if (SpeechRec) ways.push(["device", "This browser's"]);
  if (app.view && app.view.voice) ways.push(["claude", "Claude's voice mode"]);
  const pick = store.get("dictation") || "auto";
  if (ways.length > 2) {
    kids.push(h("div", { class: "seg wrap" }, ...ways.map(([value, label]) =>
      h("button", { class: `control${pick === value || (value === "auto" && !ways.some(([v]) => v === pick)) ? " on" : ""}`,
                    onclick: () => { store.set("dictation", value === "auto" ? "" : value); draw(); } }, label))));
  }
  const say = {
    host: `Hold the mic while you speak, or tap it and tap again when you're done. Your host writes it down (${d.engine || "a speech model"}): Spanish, English and 23 more languages, told apart by themselves. The audio stays on your host.`,
    device: `${/Chrome/.test(navigator.userAgent) ? "Google's" : "Apple's"} speech recognition, in this browser, in one language (below): it sends what you say to ${/Chrome/.test(navigator.userAgent) ? "Google" : "Apple"}.${iPhoneApp ? " In the home-screen app on an iPhone it often hears nothing." : ""}`,
    claude: "Claude Code's own voice mode, in sessions on Claude's terminal: what it writes down comes into the box.",
  };
  kids.push(h("p", {}, now ? say[now] : "No way to dictate here yet: set it up on the host (below)."));
  if (now === "device" || pick === "device") {
    const langs = [["es-CO", "Español"], ["en-US", "English"]];
    const lang = dictationLang();
    if (!langs.some(([v]) => v === lang)) langs.push([lang, lang]);
    kids.push(h("div", { class: "seg" }, ...langs.map(([value, label]) =>
      h("button", { class: `control${lang === value ? " on" : ""}`, onclick: () => { store.set("dictation-lang", value); draw(); } }, label))));
  }
  if (!d.ready) {
    const setup = d.setup;
    if (setup && !setup.error) {
      kids.push(h("p", {}, setup.checking ? "Checking the speech model…"
        : `Fetching the speech model: ${Math.round((setup.done || 0) / 1e6)} of ${Math.ceil((d.size || 0) / 1e7) * 10} MB.`));
      clearTimeout(dictationSettings.timer);
      dictationSettings.timer = setTimeout(() => { if (document.querySelector(".sheet-back.settings")) draw(); }, 1000);
    } else if (d.lib) {
      kids.push(h("p", {}, `Your host can write down what you say, in Spanish, English and 23 more languages, once it has the speech model (${Math.ceil((d.size || 0) / 1e7) * 10} MB).${setup && setup.error ? ` The last try stopped: ${setup.error}.` : ""}`),
        h("button", { class: "control wide accent", onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("/api/dictate/setup", {});
            if (app.view && app.view.dictation) app.view.dictation.setup = { done: 0 };
          } catch (err) { toast(err.message); }
          draw();
        } }, "Set up dictation on the host"));
    } else if (app.view && app.view.dictation) {
      kids.push(h("p", {}, "To write down what you say on your host (Spanish, English and 23 more languages): install whisper.cpp there (on Arch: sudo pacman -S whisper-cpp), then amarchy dictation setup."));
    }
  }
  kids.push(h("p", {}, app.desk ? "In Claude's terminal, hold Space to dictate with Claude's voice mode. The mic button is by the boxes of the phone layout (Layout, below)."
                                : "The keyboard's own dictation (its mic key) works in every box too."));
  return kids;
}
