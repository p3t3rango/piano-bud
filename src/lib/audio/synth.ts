// Synthesizer with instrument selection and metronome sounds

import { midiToFreq } from '../music/theory';

let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Must be called synchronously from a user gesture (tap/click) on mobile
export async function unlockAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

// ── Instrument types ──

export type Instrument = 'piano' | 'retro' | 'sine' | '8bit' | 'warm';

export const INSTRUMENTS: { id: Instrument; label: string }[] = [
  { id: 'piano', label: 'Piano' },
  { id: 'retro', label: 'Retro' },
  { id: 'sine', label: 'Sine' },
  { id: '8bit', label: '8-Bit' },
  { id: 'warm', label: 'Warm' },
];

interface InstrumentConfig {
  wave: OscillatorType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  harmonics?: { ratio: number; gain: number; wave: OscillatorType }[];
  filterFreq?: number;
}

// Piano uses a dedicated synthesis function — not the generic config
const INSTRUMENT_CONFIGS: Record<Instrument, InstrumentConfig> = {
  piano: {
    wave: 'sine', // placeholder — overridden by playPianoNote
    attack: 0.003,
    decay: 0.8,
    sustain: 0.1,
    release: 0.5,
  },
  retro: {
    wave: 'triangle',
    attack: 0.02,
    decay: 0.1,
    sustain: 0.6,
    release: 0.3,
  },
  sine: {
    wave: 'sine',
    attack: 0.01,
    decay: 0.05,
    sustain: 0.8,
    release: 0.2,
  },
  '8bit': {
    wave: 'square',
    attack: 0.005,
    decay: 0.08,
    sustain: 0.5,
    release: 0.15,
  },
  warm: {
    wave: 'sawtooth',
    attack: 0.03,
    decay: 0.15,
    sustain: 0.5,
    release: 0.3,
    filterFreq: 2000,
  },
};

// ── Note playback ──

interface NoteOptions {
  midi: number;
  duration?: number;
  instrument?: Instrument;
  volume?: number;
}

// Realistic piano note using additive synthesis with natural harmonic series
function playPianoNote(midi: number, duration: number, volume: number): void {
  const ctx = getAudioContext();
  const freq = midiToFreq(midi);
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.setValueAtTime(volume, now);
  master.connect(ctx.destination);

  // Piano harmonic amplitudes (based on real piano spectral analysis)
  // Higher harmonics decay faster, giving the characteristic piano brightness at attack
  const harmonics = [
    { ratio: 1,   amp: 1.0,   decay: duration * 0.95 },
    { ratio: 2,   amp: 0.55,  decay: duration * 0.8 },
    { ratio: 3,   amp: 0.3,   decay: duration * 0.65 },
    { ratio: 4,   amp: 0.18,  decay: duration * 0.5 },
    { ratio: 5,   amp: 0.12,  decay: duration * 0.4 },
    { ratio: 6,   amp: 0.08,  decay: duration * 0.35 },
    { ratio: 7,   amp: 0.04,  decay: duration * 0.3 },
    { ratio: 8,   amp: 0.02,  decay: duration * 0.25 },
  ];

  for (const h of harmonics) {
    const hFreq = freq * h.ratio;
    if (hFreq > 16000) continue; // Skip inaudible harmonics

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Slight inharmonicity — real piano strings are slightly sharp at upper partials
    const inharmonicity = 1 + 0.0002 * h.ratio * h.ratio;
    osc.frequency.setValueAtTime(hFreq * inharmonicity, now);

    const amp = h.amp * volume;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.003); // Very fast attack
    // Two-stage decay: fast initial drop then slow sustain (like real piano)
    gain.gain.setTargetAtTime(amp * 0.3, now + 0.003, h.decay * 0.3);
    gain.gain.setTargetAtTime(0.001, now + h.decay * 0.4, h.decay * 0.5);

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.1);
  }

  // Hammer noise transient — the percussive "thunk" of a real piano
  const noiseLen = 0.02;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(freq * 4, now);
  noiseFilter.Q.setValueAtTime(2, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(volume * 0.15, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseLen);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now);
}

export function playNote(opts: NoteOptions): void {
  const ctx = getAudioContext();
  const {
    midi,
    duration = 1,
    instrument = 'retro',
    volume = 0.3,
  } = opts;

  // Piano uses dedicated synthesis
  if (instrument === 'piano') {
    playPianoNote(midi, duration, volume);
    return;
  }

  const config = INSTRUMENT_CONFIGS[instrument];
  const freq = midiToFreq(midi);
  const now = ctx.currentTime;

  let destination: AudioNode = ctx.destination;

  // Optional low-pass filter for warm sounds
  if (config.filterFreq) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(config.filterFreq, now);
    filter.Q.setValueAtTime(1, now);
    filter.connect(ctx.destination);
    destination = filter;
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = config.wave;
  osc.frequency.setValueAtTime(freq, now);

  // ADSR
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + config.attack);
  gain.gain.linearRampToValueAtTime(volume * config.sustain, now + config.attack + config.decay);
  const sustainEnd = Math.max(now + duration - config.release, now + config.attack + config.decay);
  gain.gain.setValueAtTime(volume * config.sustain, sustainEnd);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  osc.connect(gain);
  gain.connect(destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

// Play a chord
export function playChord(
  midis: number[],
  duration = 1.5,
  instrument: Instrument = 'retro',
  stagger = 0.015
): void {
  midis.forEach((midi, i) => {
    setTimeout(() => {
      playNote({ midi, duration, instrument, volume: 0.25 / Math.sqrt(midis.length) });
    }, i * stagger * 1000);
  });
}

// Play a scale ascending then descending
export function playScale(
  rootMidi: number,
  intervals: number[],
  tempo = 200,
  instrument: Instrument = 'retro'
): void {
  const ascending = intervals.map(i => rootMidi + i);
  const descending = [...ascending].reverse().slice(1);
  const allNotes = [...ascending, rootMidi + 12, ...descending];

  allNotes.forEach((midi, i) => {
    setTimeout(() => {
      playNote({ midi, duration: tempo / 1000 * 0.9, instrument, volume: 0.3 });
    }, i * tempo);
  });
}

// Play an interval
export function playInterval(
  rootMidi: number,
  semitones: number,
  mode: 'harmonic' | 'melodic' = 'melodic',
  instrument: Instrument = 'retro'
): void {
  if (mode === 'harmonic') {
    playChord([rootMidi, rootMidi + semitones], 1.5, instrument);
  } else {
    playNote({ midi: rootMidi, duration: 0.8, instrument });
    setTimeout(() => {
      playNote({ midi: rootMidi + semitones, duration: 0.8, instrument });
    }, 900);
  }
}

// Play a chord progression
export function playProgression(
  rootMidi: number,
  degrees: number[],
  qualities: ('major' | 'minor' | 'diminished' | 'dominant7')[],
  tempo = 800,
  instrument: Instrument = 'retro'
): void {
  const chordIntervals: Record<string, number[]> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    diminished: [0, 3, 6],
    dominant7: [0, 4, 7, 10],
  };

  degrees.forEach((degree, i) => {
    setTimeout(() => {
      const base = rootMidi + degree;
      const intervals = chordIntervals[qualities[i]];
      const midis = intervals.map(iv => base + iv);
      playChord(midis, tempo / 1000 * 0.9, instrument);
    }, i * tempo);
  });
}

// ── Sound effects ──

export function playSfx(type: 'correct' | 'incorrect' | 'levelup' | 'click'): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  switch (type) {
    case 'correct': {
      [0, 0.12].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime([880, 1320][i], now + delay);
        gain.gain.setValueAtTime(0.15, now + delay);
        gain.gain.linearRampToValueAtTime(0, now + delay + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.15);
      });
      break;
    }
    case 'incorrect': {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.linearRampToValueAtTime(150, now + 0.3);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      break;
    }
    case 'levelup': {
      [523, 659, 784, 1047].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.12, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });
      break;
    }
    case 'click': {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.03);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
      break;
    }
  }
}

// ── Metronome sounds ──

export type MetronomeSound = 'click' | 'wood' | 'hihat' | 'beep';

export const METRONOME_SOUNDS: { id: MetronomeSound; label: string }[] = [
  { id: 'click', label: 'Click' },
  { id: 'wood', label: 'Wood' },
  { id: 'hihat', label: 'Hi-Hat' },
  { id: 'beep', label: 'Beep' },
];

// Beat accent level: 0 = off, 1 = normal, 2 = accent
export type BeatLevel = 0 | 1 | 2;

export function playMetronomeBeat(level: BeatLevel, sound: MetronomeSound = 'click'): void {
  if (level === 0) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const vol = level === 2 ? 0.35 : 0.18;

  switch (sound) {
    case 'click': {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(level === 2 ? 1200 : 800, now);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
      break;
    }
    case 'wood': {
      // Resonant sine burst — short, woody thock
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const freq = level === 2 ? 540 : 440;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.03);
      gain.gain.setValueAtTime(vol * 1.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
      break;
    }
    case 'hihat': {
      // White noise burst through high-pass filter
      const bufferSize = ctx.sampleRate * 0.05;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(level === 2 ? 9000 : 7500, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol * 0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (level === 2 ? 0.07 : 0.04));
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      break;
    }
    case 'beep': {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(level === 2 ? 1000 : 660, now);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
      break;
    }
  }
}

// Legacy compat
export function playMetronomeTick(accent = false): void {
  playMetronomeBeat(accent ? 2 : 1, 'click');
}
