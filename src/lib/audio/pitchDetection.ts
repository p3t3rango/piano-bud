// Pitch detection using Web Audio API
// YIN-based autocorrelation for single-note, FFT chromagram for chords

import { freqToNearestMidi, midiToPitchClass, midiToFreq } from '../music/theory';

const FFT_SIZE = 4096;
const MIN_FREQ = 65;   // ~C2 (lowest practical piano note for phone mic)
const MAX_FREQ = 2100;  // ~C7 (avoid high-frequency noise false positives)

export interface PitchResult {
  frequency: number;
  midi: number;
  confidence: number;
}

export interface ChromaResult {
  chroma: number[];
  activePitchClasses: number[];
  dominantPitchClass: number;
  rms: number;
}

export class PitchDetector {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private timeBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Float32Array<ArrayBuffer> | null = null;
  private running = false;

  private init(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.minDecibels = -80;
    this.analyser.maxDecibels = -10;
    this.timeBuf = new Float32Array(FFT_SIZE);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.init();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true, // Let the OS handle gain — avoids manual clipping issues
        },
      });
      this.source = this.audioCtx!.createMediaStreamSource(this.stream);
      // Clean signal path: mic → analyser directly. No compressor, no gain.
      this.source.connect(this.analyser!);
      if (this.audioCtx!.state === 'suspended') {
        await this.audioCtx!.resume();
      }
      this.running = true;
    } catch (err) {
      console.error('Microphone access error:', err);
      throw err;
    }
  }

  stop(): void {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  // Get RMS from already-read time domain buffer
  private computeRMS(): number {
    if (!this.timeBuf) return 0;
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      sum += this.timeBuf[i] * this.timeBuf[i];
    }
    return Math.sqrt(sum / this.timeBuf.length);
  }

  // Public RMS that reads fresh data
  getRMS(): number {
    if (!this.analyser || !this.timeBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    return this.computeRMS();
  }

  // YIN-based pitch detection
  detectPitch(): PitchResult | null {
    if (!this.running || !this.analyser || !this.timeBuf || !this.audioCtx) return null;

    // Read time domain data ONCE — all analysis uses this same snapshot
    this.analyser.getFloatTimeDomainData(this.timeBuf);

    const rms = this.computeRMS();
    if (rms < 0.008) return null; // Silence gate

    const sampleRate = this.audioCtx.sampleRate;
    const buf = this.timeBuf;
    // Only use first half of buffer for autocorrelation (more stable)
    const halfN = Math.floor(buf.length / 2);

    const minPeriod = Math.floor(sampleRate / MAX_FREQ);
    const maxPeriod = Math.min(Math.floor(sampleRate / MIN_FREQ), halfN);

    // YIN step 2: Difference function
    const diff = new Float32Array(maxPeriod + 1);
    for (let tau = 0; tau <= maxPeriod; tau++) {
      let sum = 0;
      for (let i = 0; i < halfN; i++) {
        const d = buf[i] - buf[i + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // YIN step 3: Cumulative mean normalized difference
    const cmndf = new Float32Array(maxPeriod + 1);
    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= maxPeriod; tau++) {
      runningSum += diff[tau];
      cmndf[tau] = runningSum > 0 ? diff[tau] * tau / runningSum : 1;
    }

    // YIN step 4: Absolute threshold
    // Find the first dip below threshold, then take the minimum in that valley
    const yinThreshold = 0.15;
    let bestTau = -1;

    for (let tau = minPeriod; tau < maxPeriod; tau++) {
      if (cmndf[tau] < yinThreshold) {
        // Found a dip — walk forward to find the valley minimum
        while (tau + 1 < maxPeriod && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        bestTau = tau;
        break;
      }
    }

    // Fallback: if no dip below threshold, find the global minimum in range
    if (bestTau < 0) {
      let minVal = Infinity;
      for (let tau = minPeriod; tau <= maxPeriod; tau++) {
        if (cmndf[tau] < minVal) {
          minVal = cmndf[tau];
          bestTau = tau;
        }
      }
      // Only accept if reasonably periodic
      if (minVal > 0.4) return null;
    }

    if (bestTau < 0) return null;

    // YIN step 5: Parabolic interpolation for sub-sample accuracy
    let refinedTau = bestTau;
    if (bestTau > 0 && bestTau < maxPeriod) {
      const s0 = cmndf[bestTau - 1];
      const s1 = cmndf[bestTau];
      const s2 = cmndf[bestTau + 1];
      const denom = 2 * s1 - s2 - s0;
      if (denom !== 0) {
        refinedTau = bestTau + (s0 - s2) / (2 * denom);
      }
    }

    const frequency = sampleRate / refinedTau;

    // Sanity check
    if (frequency < MIN_FREQ || frequency > MAX_FREQ) return null;

    const midi = freqToNearestMidi(frequency);
    const confidence = 1 - cmndf[bestTau]; // Higher = better (0 to 1)

    return { frequency, midi, confidence };
  }

  // Chromagram for chord detection
  getChroma(): ChromaResult {
    if (!this.analyser || !this.freqBuf || !this.audioCtx) {
      return { chroma: new Array(12).fill(0), activePitchClasses: [], dominantPitchClass: 0, rms: 0 };
    }

    this.analyser.getFloatFrequencyData(this.freqBuf);
    const sampleRate = this.audioCtx.sampleRate;
    const binCount = this.analyser.frequencyBinCount;
    const rms = this.computeRMS();

    const chroma = new Array(12).fill(0);

    for (let i = 1; i < binCount; i++) {
      const freq = (i * sampleRate) / FFT_SIZE;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

      const db = this.freqBuf[i];
      if (db < -65) continue;

      // Convert dB to power (squared amplitude) for better dynamic range
      const power = Math.pow(10, db / 10);
      const midi = freqToNearestMidi(freq);
      const pc = midiToPitchClass(midi);

      // Only count if close to a note center (within 40 cents)
      const freqExpected = midiToFreq(midi);
      const centsDiff = Math.abs(1200 * Math.log2(freq / freqExpected));
      if (centsDiff < 40) {
        // Weight by 1/harmonic_number to favor fundamentals over overtones
        const harmonicWeight = MIN_FREQ / Math.max(freq, MIN_FREQ);
        chroma[pc] += power * (1 + harmonicWeight);
      }
    }

    // Normalize
    const maxEnergy = Math.max(...chroma);
    if (maxEnergy > 0) {
      for (let i = 0; i < 12; i++) {
        chroma[i] /= maxEnergy;
      }
    }

    const threshold = 0.25;
    const activePitchClasses = chroma
      .map((e, i) => ({ energy: e, pc: i }))
      .filter(x => x.energy > threshold)
      .sort((a, b) => b.energy - a.energy)
      .map(x => x.pc);

    const dominantPitchClass = activePitchClasses[0] ?? 0;

    return { chroma, activePitchClasses, dominantPitchClass, rms };
  }
}
