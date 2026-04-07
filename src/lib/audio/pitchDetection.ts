// Two-layer pitch detection:
// 1. Pitchy — real-time single-note detection (fast, accurate)
// 2. Spotify Basic Pitch — ML polyphonic chord detection (buffered)

import { PitchDetector as PitchyDetector } from 'pitchy';
import { freqToNearestMidi, midiToPitchClass, midiToFreq } from '../music/theory';

export interface PitchResult {
  frequency: number;
  midi: number;
  confidence: number;
}

export interface ChromaResult {
  chroma: number[];
  activePitchClasses: number[];
  activeMidis: number[]; // ML-detected MIDI notes
  dominantPitchClass: number;
  rms: number;
}

// Downsample audio from source rate to target rate
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
  private timeBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Float32Array<ArrayBuffer> | null = null;
  private running = false;

  // Pitchy detector for single notes
  private pitchyDetector: ReturnType<typeof PitchyDetector.forFloat32Array> | null = null;

  // Basic Pitch ML model for chords
  private basicPitchModel: import('@spotify/basic-pitch').BasicPitch | null = null;
  private modelLoading = false;
  private modelReady = false;

  // Audio buffer for ML chord detection
  private audioRingBuffer: Float32Array | null = null;
  private ringBufferWritePos = 0;
  private readonly RING_BUFFER_SECONDS = 1.5;

  // Script processor for capturing raw audio
  private scriptNode: ScriptProcessorNode | null = null;

  // Latest ML chord results
  private _mlMidis: number[] = [];
  private _mlChroma: number[] = new Array(12).fill(0);
  private _mlLastUpdate = 0;
  private _mlProcessing = false;

  private static readonly FFT_SIZE = 4096;

  private init(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = PitchDetector.FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.8;
    this.timeBuf = new Float32Array(PitchDetector.FFT_SIZE);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    this.pitchyDetector = PitchyDetector.forFloat32Array(PitchDetector.FFT_SIZE);

    // Ring buffer for ML model (stores last N seconds at mic sample rate)
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

      // Script processor to capture raw audio into ring buffer
      // Connected to a silent gain node (NOT destination — that would cause feedback)
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

      // Load ML model in background
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
      // Dynamic imports — these are heavy, loaded only when needed
      await import('@tensorflow/tfjs');
      const { BasicPitch } = await import('@spotify/basic-pitch');
      this.basicPitchModel = new BasicPitch('/model/model.json');
      this.modelReady = true;
      console.log('Basic Pitch ML model loaded');
    } catch (err) {
      console.warn('Could not load Basic Pitch model, chord detection will use fallback:', err);
    }
    this.modelLoading = false;
  }

  stop(): void {
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
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

  isMLReady(): boolean {
    return this.modelReady;
  }

  getRMS(): number {
    if (!this.analyser || !this.timeBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      sum += this.timeBuf[i] * this.timeBuf[i];
    }
    return Math.sqrt(sum / this.timeBuf.length);
  }

  // ── Single-note detection via Pitchy ──
  detectPitch(): PitchResult | null {
    if (!this.running || !this.analyser || !this.timeBuf || !this.pitchyDetector || !this.audioCtx) {
      return null;
    }

    try {
      this.analyser.getFloatTimeDomainData(this.timeBuf);

      // Check signal level
      let sum = 0;
      for (let i = 0; i < this.timeBuf.length; i++) {
        sum += this.timeBuf[i] * this.timeBuf[i];
      }
      const rms = Math.sqrt(sum / this.timeBuf.length);
      if (rms < 0.008) return null;

      const [pitch, clarity] = this.pitchyDetector.findPitch(
        this.timeBuf,
        this.audioCtx.sampleRate
      );

      // Pitchy clarity threshold — higher = more confident
      if (clarity < 0.85 || pitch < 60 || pitch > 2100) return null;

      const midi = freqToNearestMidi(pitch);

      return {
        frequency: pitch,
        midi,
        confidence: clarity,
      };
    } catch (err) {
      console.warn('Pitch detection error:', err);
      return null;
    }
  }

  // ── Chord detection — ML when available, FFT chromagram as fallback ──
  getChroma(): ChromaResult {
    if (!this.analyser || !this.freqBuf || !this.audioCtx) {
      return { chroma: new Array(12).fill(0), activePitchClasses: [], activeMidis: [], dominantPitchClass: 0, rms: 0 };
    }

    const rms = this.getRMS();
    const now = Date.now();

    // Trigger ML inference every ~800ms if model is ready
    if (this.modelReady && !this._mlProcessing && now - this._mlLastUpdate > 800 && rms > 0.005) {
      this.runMLChordDetection();
    }

    // If ML has results, use them
    if (this._mlMidis.length > 0 && now - this._mlLastUpdate < 2000) {
      return {
        chroma: this._mlChroma,
        activePitchClasses: [...new Set(this._mlMidis.map(m => midiToPitchClass(m)))],
        activeMidis: this._mlMidis,
        dominantPitchClass: midiToPitchClass(this._mlMidis[0]),
        rms,
      };
    }

    // Fallback: FFT-based chromagram with harmonic suppression
    this.analyser.getFloatFrequencyData(this.freqBuf);
    const sampleRate = this.audioCtx.sampleRate;
    const chroma = new Array(12).fill(0);

    // First pass: find peaks (potential fundamentals)
    const peaks: { freq: number; power: number; bin: number }[] = [];
    for (let i = 2; i < this.freqBuf.length - 1; i++) {
      const freq = (i * sampleRate) / PitchDetector.FFT_SIZE;
      if (freq < 65 || freq > 2100) continue;
      const db = this.freqBuf[i];
      if (db < -55) continue;
      // Local peak check
      if (db > this.freqBuf[i - 1] && db > this.freqBuf[i + 1]) {
        peaks.push({ freq, power: Math.pow(10, db / 10), bin: i });
      }
    }

    // Second pass: suppress harmonics
    // For each peak, check if it could be a harmonic of a stronger peak
    const fundamentals = peaks.filter(peak => {
      for (const other of peaks) {
        if (other === peak) continue;
        if (other.power <= peak.power) continue;
        // Check if peak is 2nd, 3rd, 4th, or 5th harmonic of other
        for (let h = 2; h <= 5; h++) {
          const expectedHarmonicFreq = other.freq * h;
          const ratio = peak.freq / expectedHarmonicFreq;
          if (ratio > 0.97 && ratio < 1.03) {
            // This peak is likely a harmonic of 'other' — suppress it
            return false;
          }
        }
      }
      return true;
    });

    // Build chroma from fundamentals only
    for (const peak of fundamentals) {
      const midi = freqToNearestMidi(peak.freq);
      const pc = midiToPitchClass(midi);
      chroma[pc] += peak.power;
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
      // Extract audio from ring buffer (linearized)
      const ring = this.audioRingBuffer;
      const len = ring.length;
      const linear = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        linear[i] = ring[(this.ringBufferWritePos + i) % len];
      }

      // Downsample to 22050Hz (Basic Pitch requirement)
      const resampled = downsample(linear, this.audioCtx.sampleRate, 22050);

      // Run model
      const allFrames: number[][] = [];
      const allOnsets: number[][] = [];

      await this.basicPitchModel.evaluateModel(
        resampled,
        (frames, onsets) => {
          allFrames.push(...frames);
          allOnsets.push(...onsets);
        },
        () => {} // progress callback
      );

      if (allFrames.length === 0) {
        this._mlMidis = [];
        this._mlChroma = new Array(12).fill(0);
        this._mlLastUpdate = Date.now();
        this._mlProcessing = false;
        return;
      }

      // Use the last few frames (most recent audio) to find currently-playing notes
      const { outputToNotesPoly } = await import('@spotify/basic-pitch');
      const recentFrames = allFrames.slice(-30); // Last ~0.35s
      const recentOnsets = allOnsets.slice(-30);
      const notes = outputToNotesPoly(
        recentFrames,
        recentOnsets,
        0.4,  // onset threshold
        0.25, // frame threshold
        2,    // min note length (shorter for real-time)
        true, // infer onsets
        null, // max freq
        null, // min freq
        false // no melodia trick for real-time
      );

      // Extract unique MIDI notes, sorted by amplitude
      const midiMap = new Map<number, number>();
      for (const note of notes) {
        const existing = midiMap.get(note.pitchMidi) ?? 0;
        midiMap.set(note.pitchMidi, Math.max(existing, note.amplitude));
      }

      // Also check raw frame activations for currently-sounding notes
      if (allFrames.length > 0) {
        const lastFrame = allFrames[allFrames.length - 1];
        for (let i = 0; i < lastFrame.length; i++) {
          if (lastFrame[i] > 0.3) {
            const midi = i + 21; // MIDI offset
            const existing = midiMap.get(midi) ?? 0;
            midiMap.set(midi, Math.max(existing, lastFrame[i]));
          }
        }
      }

      const sortedMidis = Array.from(midiMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([midi]) => midi)
        .slice(0, 6); // Max 6 notes

      this._mlMidis = sortedMidis;

      // Build chromagram from detected notes
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
    }

    this._mlLastUpdate = Date.now();
    this._mlProcessing = false;
  }
}
