// The phone's microphone, for dictating to a session's Claude (see
// "dictation" in app.js): what it hears, as 16 kHz 16-bit mono, in 20 ms
// pieces, the way Claude's voice mode records it.

const RATE = 16000;
const PIECE = 320;      // samples: 20 ms

class Mic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / RATE;      // the phone's samples to one of ours
    this.pos = 0;
    this.acc = 0;
    this.count = 0;
    this.out = new Int16Array(PIECE);
    this.n = 0;
  }

  // Each of ours the average of the phone's it stands for: down to 16 kHz
  // without what's above 8 kHz folding back in.
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.count++;
      if (++this.pos >= this.step) {
        this.pos -= this.step;
        const v = Math.max(-1, Math.min(1, this.acc / this.count));
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.acc = 0;
        this.count = 0;
        if (this.n === PIECE) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(PIECE);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("amarchy-mic", Mic);
