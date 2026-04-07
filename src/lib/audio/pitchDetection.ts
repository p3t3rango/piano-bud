// Two-layer pitch detection:
// 1. Pitchy — real-time single-note detection (fast, accurate)
// 2. Spotify Basic Pitch — ML polyphonic chord detection (buffered)

import { PitchDetector as PitchyDetector } from 'pitchy';
import { freqToNearestMidi, midiToPitchClass, midiToFreq, midiToNoteName } from '../music/theory';

export interface PitchResult {
  frequency: number;
  midi: number;
  confidence: number;
}

export interface ChromaResult {
  chroma: number[];
  activePitchClasses: number[];
  activeMidis: number[];
  dominantPitchClass: number;
  rms: number;
}

function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = buffer[Math.floor(i * ratio)];
  }
  return result;
}

export class PitchDetector {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  // Separate buffers so Pitchy and RMS don't overwrite each other
  private pitchBuf: Float32Array<ArrayBuffer> | null = null;
  private rmsBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Float32Array<ArrayBuffer> | null = null;
  private running = false;

  private pitchyDetector: ReturnType<typeof PitchyDetector.forFloat32Array> | null = null;

  // Basic Pitch ML
  private basicPitchModel: import('@spotify/basic-pitch').BasicPitch | null = null;
  private modelLoading = false;
  private modelReady = false;

  // Ring buffer for ML
  private audioRingBuffer: Float32Array | null = null;
  private ringBufferWritePos = 0;
  private readonly RING_BUFFER_SECONDS = 2;

  private scriptNode: ScriptProcessorNode | null = null;

  // ML results
  private _mlMidis: number[] = [];
  private _mlChroma: number[] = new Array(12).fill(0);
  private _mlLastUpdate = 0;
  private _mlProcessing = false;

  // Debug
  public mlDebug = '';

  private static readonly FFT_SIZE = 4096;

  private init(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = PitchDetector.FFT_SIZE;
    // LOW smoothing = fast response to new notes
    this.analyser.smoothingTimeConstant = 0.3;
    this.pitchBuf = new Float32Array(PitchDetector.FFT_SIZE);
    this.rmsBuf = new Float32Array(PitchDetector.FFT_SIZE);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    this.pitchyDetector = PitchyDetector.forFloat32Array(PitchDetector.FFT_SIZE);

    const bufLen = Math.ceil(this.audioCtx.sampleRate * this.RING_BUFFER_SECONDS);
    this.audioRingBuffer = new Float32Array(bufLen);
    this.ringBufferWritePos = 0;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.init();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      this.source = this.audioCtx!.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser!);

      this.scriptNode = this.audioCtx!.createScriptProcessor(4096, 1, 1);
      this.scriptNode.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const ring = this.audioRingBuffer!;
        for (let i = 0; i < input.length; i++) {
          ring[this.ringBufferWritePos] = input[i];
          this.ringBufferWritePos = (this.ringBufferWritePos + 1) % ring.length;
        }
      };
      const silentGain = this.audioCtx!.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(this.audioCtx!.destination);
      this.source.connect(this.scriptNode);
      this.scriptNode.connect(silentGain);

      if (this.audioCtx!.state === 'suspended') {
        await this.audioCtx!.resume();
      }
      this.running = true;
      this.loadModel();
    } catch (err) {
      console.error('Microphone error:', err);
      throw err;
    }
  }

  private async loadModel(): Promise<void> {
    if (this.modelLoading || this.modelReady) return;
    this.modelLoading = true;
    try {
      await import('@tensorflow/tfjs');
      const { BasicPitch } = await import('@spotify/basic-pitch');
      this.basicPitchModel = new BasicPitch('/model/model.json');
      this.modelReady = true;
      console.log('Basic Pitch ML model loaded');
    } catch (err) {
      console.warn('Could not load Basic Pitch model:', err);
    }
    this.modelLoading = false;
  }

  stop(): void {
    if (this.scriptNode) { this.scriptNode.disconnect(); this.scriptNode = null; }
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.running = false;
  }

  isRunning(): boolean { return this.running; }
  isMLReady(): boolean { return this.modelReady; }

  // RMS using its own buffer — doesn't interfere with Pitchy
  getRMS(): number {
    if (!this.analyser || !this.rmsBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.rmsBuf);
    let sum = 0;
    for (let i = 0; i < this.rmsBuf.length; i++) {
      sum += this.rmsBuf[i] * this.rmsBuf[i];
    }
    return Math.sqrt(sum / this.rmsBuf.length);
  }

  // ── Single note via Pitchy ──
  detectPitch(): PitchResult | null {
    if (!this.running || !this.analyser || !this.pitchBuf || !this.pitchyDetector || !this.audioCtx) {
      return null;
    }
    try {
      // Read into pitchBuf (separate from rmsBuf)
      this.analyser.getFloatTimeDomainData(this.pitchBuf);

      let sum = 0;
      for (let i = 0; i < this.pitchBuf.length; i++) {
        sum += this.pitchBuf[i] * this.pitchBuf[i];
      }
      const rms = Math.sqrt(sum / this.pitchBuf.length);
      if (rms < 0.005) return null; // Lower gate for sensitivity

      const [pitch, clarity] = this.pitchyDetector.findPitch(
        this.pitchBuf,
        this.audioCtx.sampleRate
      );

      // Lower clarity threshold for phone mics
      if (clarity < 0.75 || pitch < 60 || pitch > 2100) return null;

      return {
        frequency: pitch,
        midi: freqToNearestMidi(pitch),
        confidence: clarity,
      };
    } catch {
      return null;
    }
  }

  // ── Chord detection ──
  getChroma(): ChromaResult {
    if (!this.analyser || !this.freqBuf || !this.audioCtx) {
      return { chroma: new Array(12).fill(0), activePitchClasses: [], activeMidis: [], dominantPitchClass: 0, rms: 0 };
    }

    const rms = this.getRMS();
    const now = Date.now();

    // DON'T clear ML results based on RMS — use timeout instead.
    // Piano chords decay slowly. Let results persist until next ML update.

    // Run ML every 500ms when there's signal
    if (this.modelReady && !this._mlProcessing && now - this._mlLastUpdate > 500 && rms > 0.008) {
      this.runMLChordDetection();
    }

    // Clear ML results after 2.5s with no update (true silence)
    if (this._mlMidis.length > 0 && now - this._mlLastUpdate > 2500) {
      this._mlMidis = [];
      this._mlChroma = new Array(12).fill(0);
    }

    // Return ML results if available
    if (this._mlMidis.length > 0) {
      return {
        chroma: this._mlChroma,
        activePitchClasses: [...new Set(this._mlMidis.map(m => midiToPitchClass(m)))],
        activeMidis: this._mlMidis,
        dominantPitchClass: midiToPitchClass(this._mlMidis[0]),
        rms,
      };
    }

    // Fallback: FFT chromagram
    this.analyser.getFloatFrequencyData(this.freqBuf);
    const sampleRate = this.audioCtx.sampleRate;
    const chroma = new Array(12).fill(0);

    for (let i = 2; i < this.freqBuf.length - 1; i++) {
      const freq = (i * sampleRate) / PitchDetector.FFT_SIZE;
      if (freq < 65 || freq > 2100) continue;
      const db = this.freqBuf[i];
      if (db < -50) continue;
      if (db > this.freqBuf[i - 1] && db > this.freqBuf[i + 1]) {
        const power = Math.pow(10, db / 10);
        const midi = freqToNearestMidi(freq);
        const pc = midiToPitchClass(midi);
        chroma[pc] += power;
      }
    }

    const maxEnergy = Math.max(...chroma);
    if (maxEnergy > 0) {
      for (let i = 0; i < 12; i++) chroma[i] /= maxEnergy;
    }

    const activePitchClasses = chroma
      .map((e, i) => ({ e, i }))
      .filter(x => x.e > 0.25)
      .sort((a, b) => b.e - a.e)
      .map(x => x.i);

    return {
      chroma,
      activePitchClasses,
      activeMidis: [],
      dominantPitchClass: activePitchClasses[0] ?? 0,
      rms,
    };
  }

  private async runMLChordDetection(): Promise<void> {
    if (!this.basicPitchModel || !this.audioRingBuffer || !this.audioCtx) return;
    this._mlProcessing = true;

    try {
      const ring = this.audioRingBuffer;
      const len = ring.length;

      // Only use the most recent ~1 second (not full 2s buffer)
      // This prevents old notes from contaminating results
      const recentSamples = Math.floor(this.audioCtx.sampleRate * 1.0);
      const startPos = (this.ringBufferWritePos - recentSamples + len) % len;
      const linear = new Float32Array(recentSamples);
      for (let i = 0; i < recentSamples; i++) {
        linear[i] = ring[(startPos + i) % len];
      }

      const resampled = downsample(linear, this.audioCtx.sampleRate, 22050);

      const allFrames: number[][] = [];
      const allOnsets: number[][] = [];

      await this.basicPitchModel.evaluateModel(
        resampled,
        (frames, onsets) => {
          allFrames.push(...frames);
          allOnsets.push(...onsets);
        },
        () => {}
      );

      if (allFrames.length === 0) {
        this._mlMidis = [];
        this._mlChroma = new Array(12).fill(0);
        this.mlDebug = 'no frames';
        this._mlLastUpdate = Date.now();
        this._mlProcessing = false;
        return;
      }

      const { outputToNotesPoly } = await import('@spotify/basic-pitch');
      const notes = outputToNotesPoly(
        allFrames,
        allOnsets,
        0.25, // onset threshold — sensitive
        0.15, // frame threshold — sensitive
        2,    // min note length
        true, // infer onsets
        2100, // max freq
        65,   // min freq
        true  // melodia trick
      );

      // Collect notes with amplitude above threshold
      const MIN_MIDI = 36;
      const MAX_MIDI = 96;
      const AMP_THRESHOLD = 0.3;
      const midiMap = new Map<number, number>();
      for (const note of notes) {
        if (note.pitchMidi < MIN_MIDI || note.pitchMidi > MAX_MIDI) continue;
        if (note.amplitude < AMP_THRESHOLD) continue;
        const existing = midiMap.get(note.pitchMidi) ?? 0;
        midiMap.set(note.pitchMidi, Math.max(existing, note.amplitude));
      }

      // Also check last few frames for currently-active notes
      // (notes that are sustaining but didn't have a recent onset)
      const lastFrames = allFrames.slice(-5);
      for (const frame of lastFrames) {
        for (let i = 0; i < frame.length; i++) {
          if (frame[i] > 0.5) { // High threshold for raw frame check
            const midi = i + 21;
            if (midi >= MIN_MIDI && midi <= MAX_MIDI) {
              const existing = midiMap.get(midi) ?? 0;
              midiMap.set(midi, Math.max(existing, frame[i]));
            }
          }
        }
      }

      let sortedMidis = Array.from(midiMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([midi]) => midi)
        .slice(0, 6);

      // Span check — discard if notes are scattered across > 2 octaves
      if (sortedMidis.length >= 2) {
        const span = Math.max(...sortedMidis) - Math.min(...sortedMidis);
        if (span > 24) {
          this.mlDebug = `SKIP span=${span}: ${sortedMidis.map(m => midiToNoteName(m)).join(' ')}`;
          this._mlMidis = [];
          this._mlChroma = new Array(12).fill(0);
          this._mlLastUpdate = Date.now();
          this._mlProcessing = false;
          return;
        }
      }

      // Debug display
      const debugParts = Array.from(midiMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([midi, amp]) => `${midiToNoteName(midi)}(${amp.toFixed(2)})`);
      this.mlDebug = sortedMidis.length > 0
        ? debugParts.join(' ')
        : `0 notes (raw: ${notes.length})`;

      this._mlMidis = sortedMidis;

      // Build chroma
      const chroma = new Array(12).fill(0);
      for (const [midi, amp] of midiMap.entries()) {
        chroma[midiToPitchClass(midi)] += amp;
      }
      const maxC = Math.max(...chroma);
      if (maxC > 0) {
        for (let i = 0; i < 12; i++) chroma[i] /= maxC;
      }
      this._mlChroma = chroma;

    } catch (err) {
      console.warn('ML chord detection error:', err);
      this.mlDebug = `error: ${err}`;
    }

    this._mlLastUpdate = Date.now();
    this._mlProcessing = false;
  }
}
