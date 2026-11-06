// Forge original byte-level recurrent network. No external library, no pretrained weights.
// Architecture: h_t = tanh(E[x_t] + R h_{t-1} + b); p_t = softmax(O h_t + c). Vocabulary = 256 byte values.
export const KEYS = ['E', 'R', 'O', 'b', 'c'];
export const encoder = new TextEncoder();
export const EOS = 3;
export const MIN_H = 8, MAX_H = 1024, MAX_WINDOW = 32, MAX_PROMPT_BYTES = 2048, MAX_RULES_BYTES = 16384, MAX_GENERATION = 512;
export function promptText(text) { return `User:\n${text}\nForge:\n`; }
export function parameterCount(H) { return 2 * 256 * H + H * H + H + 256; }
export class RNN {
  constructor({ H = 800, V = 256, seed = 1919 } = {}) {
    if (!Number.isInteger(H) || H < MIN_H || H > MAX_H || V !== 256) throw Error(`Unsupported model dimensions: hidden size must be an integer ${MIN_H}–${MAX_H}`);
    this.H = H; this.V = V; this.steps = 0;
    let s = (seed >>> 0) || 1919;
    const random = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    const sizes = { E: V * H, R: H * H, O: V * H, b: H, c: V };
    this.grad = {};
    for (const k of KEYS) {
      this[k] = new Float32Array(sizes[k]); this.grad[k] = new Float32Array(sizes[k]);
      if (k !== 'b' && k !== 'c') for (let i = 0; i < sizes[k]; i++) this[k][i] = (random() * 2 - 1) * Math.sqrt(3 / H);
    }
    this.maxT = MAX_WINDOW;
    this.hs = Array.from({ length: MAX_WINDOW + 1 }, () => new Float32Array(H));
    this.ps = Array.from({ length: MAX_WINDOW }, () => new Float32Array(V));
    this.next = new Float32Array(H); this.dz = new Float32Array(H); this.dy = new Float32Array(V);
  }
  get parameterCount() { return KEYS.reduce((n, k) => n + this[k].length, 0); }
  forward(token, old, h = new Float32Array(this.H), p = new Float32Array(this.V)) {
    const H = this.H, V = this.V, H4 = H - (H & 3), E = this.E, R = this.R, O = this.O, b = this.b, c = this.c;
    for (let j = 0; j < H; j++) {
      const base = j * H; let s0 = E[token * H + j] + b[j], s1 = 0, s2 = 0, s3 = 0, k = 0;
      for (; k < H4; k += 4) { s0 += R[base + k] * old[k]; s1 += R[base + k + 1] * old[k + 1]; s2 += R[base + k + 2] * old[k + 2]; s3 += R[base + k + 3] * old[k + 3]; }
      for (; k < H; k++) s0 += R[base + k] * old[k];
      h[j] = Math.tanh(s0 + s1 + s2 + s3);
    }
    let max = -Infinity, z = 0;
    for (let i = 0; i < V; i++) {
      const base = i * H; let s0 = c[i], s1 = 0, s2 = 0, s3 = 0, j = 0;
      for (; j < H4; j += 4) { s0 += O[base + j] * h[j]; s1 += O[base + j + 1] * h[j + 1]; s2 += O[base + j + 2] * h[j + 2]; s3 += O[base + j + 3] * h[j + 3]; }
      for (; j < H; j++) s0 += O[base + j] * h[j];
      const s = s0 + s1 + s2 + s3; p[i] = s; if (s > max) max = s;
    }
    for (let i = 0; i < V; i++) z += (p[i] = Math.exp(p[i] - max));
    for (let i = 0; i < V; i++) p[i] /= z;
    return { h, p };
  }
  // Run bytes through the network from an optional starting state; returns the final hidden state (no weight change).
  warm(bytes, initial = null) {
    let h = initial ? initial.slice() : new Float32Array(this.H), next = new Float32Array(this.H), p = new Float32Array(256);
    for (const token of bytes) { this.forward(token, h, next, p); [h, next] = [next, h]; }
    return h;
  }
  loss(tokens, mask = null, initial = null) {
    let h = initial ? initial.slice() : new Float32Array(this.H), next = new Float32Array(this.H), p = new Float32Array(256), sum = 0, targets = 0;
    for (let t = 0; t < tokens.length - 1; t++) {
      this.forward(tokens[t], h, next, p); [h, next] = [next, h];
      if (!mask || mask[t]) { sum -= Math.log(Math.max(1e-30, p[tokens[t + 1]])); targets++; }
    }
    return targets ? sum / targets : null;
  }
  // Truncated backpropagation through time over one window of at most MAX_WINDOW targets. SGD with global-norm clipping.
  train(tokens, { mask = null, initial = null, learningRate = 0.05 } = {}) {
    const T = tokens.length - 1, H = this.H, V = this.V, g = this.grad, H4 = H - (H & 3), R = this.R, O = this.O;
    if (T < 1 || T > this.maxT || !Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 0.2 || (mask && mask.length !== T)) throw Error('Invalid training window');
    const count = mask ? Array.from(mask).filter(Boolean).length : T;
    if (!count) throw Error('Training window has no labelled targets');
    for (const k of KEYS) g[k].fill(0);
    this.hs[0].fill(0); if (initial) this.hs[0].set(initial);
    let loss = 0;
    for (let t = 0; t < T; t++) {
      this.forward(tokens[t], this.hs[t], this.hs[t + 1], this.ps[t]);
      if (!mask || mask[t]) loss -= Math.log(Math.max(1e-30, this.ps[t][tokens[t + 1]])) / count;
    }
    this.next.fill(0);
    for (let t = T - 1; t >= 0; t--) {
      const active = !mask || mask[t], h = this.hs[t + 1], prev = this.hs[t], dy = this.dy, dz = this.dz, nx = this.next;
      for (let i = 0; i < V; i++) dy[i] = active ? (this.ps[t][i] - (i === tokens[t + 1] ? 1 : 0)) / count : 0;
      for (let j = 0; j < H; j++) {
        let d = nx[j];
        for (let i = 0; i < V; i++) { const dyi = dy[i]; d += O[i * H + j] * dyi; g.O[i * H + j] += dyi * h[j]; }
        dz[j] = d * (1 - h[j] * h[j]);
        g.b[j] += dz[j]; g.E[tokens[t] * H + j] += dz[j];
      }
      nx.fill(0);
      for (let j = 0; j < H; j++) {
        const dzj = dz[j], base = j * H, gR = g.R; let k = 0;
        for (; k < H4; k += 4) {
          gR[base + k] += dzj * prev[k]; nx[k] += R[base + k] * dzj;
          gR[base + k + 1] += dzj * prev[k + 1]; nx[k + 1] += R[base + k + 1] * dzj;
          gR[base + k + 2] += dzj * prev[k + 2]; nx[k + 2] += R[base + k + 2] * dzj;
          gR[base + k + 3] += dzj * prev[k + 3]; nx[k + 3] += R[base + k + 3] * dzj;
        }
        for (; k < H; k++) { gR[base + k] += dzj * prev[k]; nx[k] += R[base + k] * dzj; }
      }
      for (let i = 0; i < V; i++) g.c[i] += dy[i];
    }
    let norm = 0;
    for (const k of KEYS) for (const x of g[k]) { if (!Number.isFinite(x)) throw Error('Invalid gradient; update rejected'); norm += x * x; }
    const scale = learningRate * Math.min(1, 1 / Math.max(1e-30, Math.sqrt(norm)));
    for (const k of KEYS) for (let i = 0; i < g[k].length; i++) if (!Number.isFinite(Math.fround(this[k][i] - scale * g[k][i]))) throw Error('Non-finite candidate weights');
    let changedParameters = 0, deltaSquared = 0;
    for (const k of KEYS) for (let i = 0; i < g[k].length; i++) {
      const before = this[k][i]; this[k][i] -= scale * g[k][i];
      const d = this[k][i] - before; if (d !== 0) changedParameters++; deltaSquared += d * d;
    }
    this.steps++;
    return { step: this.steps, lossBefore: loss, lossAfter: this.loss(tokens, mask, initial), changedParameters, deltaL2: Math.sqrt(deltaSquared), targets: count, gradientNorm: Math.sqrt(norm) };
  }
  checkpoint({ json = false } = {}) {
    const data = { format: 'forge-rnn-v1', H: this.H, V: this.V, steps: this.steps };
    for (const k of KEYS) data[k] = json ? Array.from(this[k]) : this[k].slice();
    return data;
  }
  static restore(data) {
    if (!data || data.format !== 'forge-rnn-v1' || !Number.isSafeInteger(data.steps) || data.steps < 0) throw Error('Invalid checkpoint');
    const net = new RNN({ H: data.H, V: data.V });
    for (const k of KEYS) {
      if ((!Array.isArray(data[k]) && !(data[k] instanceof Float32Array)) || data[k].length !== net[k].length) throw Error('Invalid weights');
      for (const x of data[k]) if (!Number.isFinite(x) || !Number.isFinite(Math.fround(x))) throw Error('Non-finite checkpoint weights');
      net[k].set(data[k]);
    }
    net.steps = data.steps; return net;
  }
  async fingerprint() {
    const packed = new Float32Array(this.parameterCount); let offset = 0;
    for (const k of KEYS) { packed.set(this[k], offset); offset += this[k].length; }
    const digest = await crypto.subtle.digest('SHA-256', packed.buffer);
    return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
  }
  // Greedy decoding from an optional starting state (for example, the state after the model's rules). Never changes weights.
  generate(text, length = 80, { initial = null } = {}) {
    const input = encoder.encode(promptText(text));
    if (input.length > MAX_PROMPT_BYTES) throw Error(`Question including format exceeds ${MAX_PROMPT_BYTES.toLocaleString()} UTF-8 bytes; nothing truncated`);
    if (!Number.isInteger(length) || length < 1 || length > MAX_GENERATION) throw Error('Invalid generation length');
    let h = initial ? initial.slice() : new Float32Array(this.H), p;
    for (const token of input) ({ h, p } = this.forward(token, h));
    const out = [];
    for (let n = 0; n < length; n++) {
      let token = 0; for (let i = 1; i < p.length; i++) if (p[i] > p[token]) token = i;
      if (token === EOS) break;
      out.push(token); ({ h, p } = this.forward(token, h));
    }
    return new TextDecoder().decode(new Uint8Array(out));
  }
}
