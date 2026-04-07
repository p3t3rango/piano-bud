// Pitch detection using Web Audio API
// Autocorrelation for single-note, FFT peaks for chords

import { freqToNearestMidi, midiToPitchClass, midiToFreq } from '../music/theory';

const FFT_SIZE = 8192; // Higher for better frequency resolution
const MIN_FREQ = 55;  // ~A1
const MAX_FREQ = 4200; // ~C8

export interface PitchResult {
  frequency: number;
  midi: number;
  confidence: number;
}

export interface ChromaResult {
  chroma: number[]; // 12-element array of pitch class energies
  activePitchClasses: number[]; // Pitch classes above threshold
  dominantPitchClass: number;
  rms: number; // Volume level
}

export class PitchDetector {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private timeDomainBuffer: Float32Array<ArrayBuffer> | null = null;
  private frequencyBuffer: Float32Array<ArrayBuffer> | null = null;
  private running = false;

  // Lazy init - must be called from user gesture on mobile
  private gainNode: GainNode | null = null;

  private init(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.75;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;
    // Boost input gain for quiet sources (phone mic picking up piano across the room)
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 4.0; // 4x boost
    this.gainNode.connect(this.analyser);
    this.timeDomainBuffer = new Float32Array(FFT_SIZE);
    this.frequencyBuffer = new Float32Array(this.analyser.frequencyBinCount);
  }

  async start(): Promise<void> {
    if (this.running) return;
    // Init audio context synchronously in user gesture
    this.init();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.source = this.audioCtx!.createMediaStreamSource(this.stream);
      this.source.connect(this.gainNode!);
      if (this.audioCtx!.state === 'suspended') {
        await this.audioCtx!.resume();
      }
      this.running = true;
    } catch (err) {
      console.error('Microphone access denied:', err);
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

  // Get RMS volume level (0-1)
  getRMS(): number {
    if (!this.analyser || !this.timeDomainBuffer) return 0;
    this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
    let sum = 0;
    for (let i = 0; i < this.timeDomainBuffer.length; i++) {
      sum += this.timeDomainBuffer[i] * this.timeDomainBuffer[i];
    }
    return Math.sqrt(sum / this.timeDomainBuffer.length);
  }

  // Detect single pitch using autocorrelation
  detectPitch(): PitchResult | null {
    if (!this.running || !this.analyser || !this.timeDomainBuffer || !this.audioCtx) return null;

    this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);

    // Check if there's enough signal
    const rms = this.getRMS();
    if (rms < 0.003) return null; // Lower threshold for better sensitivity

    const sampleRate = this.audioCtx!.sampleRate;
    const buf = this.timeDomainBuffer;
    const n = buf.length;

    // Autocorrelation
    const minPeriod = Math.floor(sampleRate / MAX_FREQ);
    const maxPeriod = Math.floor(sampleRate / MIN_FREQ);

    // Normalized squared difference function (like YIN algorithm)
    const nsdf = new Float32Array(maxPeriod + 1);
    for (let tau = minPeriod; tau <= maxPeriod; tau++) {
      let acf = 0;
      let div = 0;
      for (let i = 0; i < n - tau; i++) {
        acf += buf[i] * buf[i + tau];
        div += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
      }
      nsdf[tau] = div > 0 ? 2 * acf / div : 0;
    }

    // Find the first peak above threshold
    let bestTau = -1;
    let bestVal = 0.2; // lower threshold for better sensitivity
    let rising = false;

    for (let tau = minPeriod; tau <= maxPeriod; tau++) {
      if (nsdf[tau] > nsdf[tau - 1]) {
        rising = true;
      } else if (rising && nsdf[tau] < nsdf[tau - 1]) {
        // We just passed a peak
        if (nsdf[tau - 1] > bestVal) {
          bestVal = nsdf[tau - 1];
          bestTau = tau - 1;
          break; // Take the first good peak (fundamental)
        }
        rising = false;
      }
    }

    if (bestTau < 0) return null;

    // Parabolic interpolation for sub-sample accuracy
    const prev = nsdf[bestTau - 1] || 0;
    const curr = nsdf[bestTau];
    const next = nsdf[bestTau + 1] || 0;
    const shift = (prev - next) / (2 * (prev - 2 * curr + next));
    const refinedTau = bestTau + (isFinite(shift) ? shift : 0);

    const frequency = sampleRate / refinedTau;
    const midi = freqToNearestMidi(frequency);

    return {
      frequency,
      midi,
      confidence: bestVal,
    };
  }

  // Get chromagram from FFT data (for chord detection)
  getChroma(): ChromaResult {
    if (!this.analyser || !this.frequencyBuffer || !this.audioCtx) {
      return { chroma: new Array(12).fill(0), activePitchClasses: [], dominantPitchClass: 0, rms: 0 };
    }
    this.analyser.getFloatFrequencyData(this.frequencyBuffer);
    const sampleRate = this.audioCtx.sampleRate;
    const binCount = this.analyser.frequencyBinCount;

    const chroma = new Array(12).fill(0);
    const rms = this.getRMS();

    // Map each FFT bin to its pitch class and accumulate energy
    for (let i = 1; i < binCount; i++) {
      const freq = (i * sampleRate) / FFT_SIZE;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

      // Convert dB to linear (frequencyBuffer is in dB)
      const db = this.frequencyBuffer[i];
      if (db < -70) continue; // Lower threshold for quiet signals

      const energy = Math.pow(10, db / 20);
      const midi = freqToNearestMidi(freq);
      const pc = midiToPitchClass(midi);

      // Weight lower harmonics more heavily
      const midiExpected = midi;
      const freqExpected = midiToFreq(midiExpected);
      const centsDiff = Math.abs(1200 * Math.log2(freq / freqExpected));
      if (centsDiff < 50) {
        chroma[pc] += energy;
      }
    }

    // Normalize chroma
    const maxEnergy = Math.max(...chroma);
    if (maxEnergy > 0) {
      for (let i = 0; i < 12; i++) {
        chroma[i] /= maxEnergy;
      }
    }

    // Find active pitch classes (above threshold)
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
