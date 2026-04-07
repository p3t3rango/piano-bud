'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import PianoKeyboard from '@/components/PianoKeyboard';
import { PitchDetector } from '@/lib/audio/pitchDetection';
import { detectChordFromChroma, detectChordFromMidis, formatChord, formatChordFull, type DetectedChord } from '@/lib/music/chords';
import { getIntervalName } from '@/lib/music/intervals';
import { unlockAudio } from '@/lib/audio/synth';
import { midiToNoteName, pitchClassName, freqToCentsOff, NOTE_NAMES } from '@/lib/music/theory';

// Stable display state — updated via refs, flushed to React on a throttle
interface DisplayState {
  noteName: string;
  frequency: number;
  centsOff: number;
  midi: number;
  hasNote: boolean;
  chord: DetectedChord | null;
  chordLabel: string;
  chordFull: string;
  chordNotes: string;
  intervalName: string;
  intervalFrom: string;
  intervalTo: string;
  hasInterval: boolean;
  volume: number;
  chroma: number[];
  activePCs: number[];
}

const EMPTY_CHROMA = new Array(12).fill(0);

function emptyDisplay(): DisplayState {
  return {
    noteName: '', frequency: 0, centsOff: 0, midi: 0, hasNote: false,
    chord: null, chordLabel: '', chordFull: '', chordNotes: '',
    intervalName: '', intervalFrom: '', intervalTo: '', hasInterval: false,
    volume: 0, chroma: EMPTY_CHROMA, activePCs: [],
  };
}

export default function ListenPage() {
  const [isListening, setIsListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<DisplayState>(emptyDisplay);

  const detectorRef = useRef<PitchDetector | null>(null);
  const rafRef = useRef<number>(0);
  const displayRef = useRef<DisplayState>(emptyDisplay());

  // Hold timers — keep values visible for a minimum duration
  const noteHoldUntil = useRef(0);
  const chordHoldUntil = useRef(0);
  const lastFlush = useRef(0);

  // Note history for intervals (stored in ref to avoid state churn)
  const noteHistory = useRef<{ midi: number; time: number }[]>([]);

  // Smoothed chroma (exponential moving average)
  const smoothChroma = useRef<number[]>(new Array(12).fill(0));

  const HOLD_MS = 800;      // Keep detected values visible for 800ms minimum
  const FLUSH_MS = 120;     // Only update React state every 120ms
  const SMOOTH_FACTOR = 0.3; // Chroma smoothing (0 = full smooth, 1 = no smooth)

  const analyze = useCallback(() => {
    if (!detectorRef.current?.isRunning()) return;

    const detector = detectorRef.current;
    const now = Date.now();
    const d = displayRef.current;

    // Volume (always update ref, cheap)
    const rms = detector.getRMS();
    d.volume = Math.min(rms * 10, 1);

    // Pitch detection (YIN confidence: 0-1, higher = more periodic)
    const pitch = detector.detectPitch();
    if (pitch && pitch.confidence > 0.5) {
      d.hasNote = true;
      d.noteName = midiToNoteName(pitch.midi);
      d.frequency = pitch.frequency;
      d.centsOff = freqToCentsOff(pitch.frequency);
      d.midi = pitch.midi;
      noteHoldUntil.current = now + HOLD_MS;

      // Track for interval detection
      const hist = noteHistory.current;
      const lastEntry = hist[hist.length - 1];
      if (!lastEntry || pitch.midi !== lastEntry.midi || now - lastEntry.time > 400) {
        hist.push({ midi: pitch.midi, time: now });
        if (hist.length > 5) hist.shift();
      }

      // Calculate interval from last 2 distinct notes (within 5 seconds)
      const recent = hist.filter(h => now - h.time < 5000);
      if (recent.length >= 2) {
        const prev = recent[recent.length - 2];
        const curr = recent[recent.length - 1];
        const semitones = Math.abs(curr.midi - prev.midi);
        if (semitones > 0 && semitones <= 12) {
          d.hasInterval = true;
          d.intervalName = getIntervalName(semitones);
          d.intervalFrom = midiToNoteName(prev.midi);
          d.intervalTo = midiToNoteName(curr.midi);
        }
      }
    } else if (now > noteHoldUntil.current) {
      d.hasNote = false;
    }

    // ML chord detection — getChroma() returns ML results when model is ready
    const rawChroma = detector.getChroma();
    const sc = smoothChroma.current;
    for (let i = 0; i < 12; i++) {
      sc[i] = sc[i] * (1 - SMOOTH_FACTOR) + rawChroma.chroma[i] * SMOOTH_FACTOR;
    }
    d.chroma = [...sc];

    // Chord detection
    if (rawChroma.activeMidis && rawChroma.activeMidis.length >= 2) {
      // ML path: use detected MIDI notes directly (no harmonics problem)
      d.activePCs = rawChroma.activePitchClasses;
      const chord = detectChordFromMidis(rawChroma.activeMidis);
      if (chord) {
        d.chord = chord;
        d.chordLabel = formatChord(chord);
        d.chordFull = formatChordFull(chord);
        d.chordNotes = rawChroma.activeMidis.map(m => midiToNoteName(m)).join(' - ');
        chordHoldUntil.current = now + HOLD_MS;
      } else if (now > chordHoldUntil.current) {
        d.chord = null;
      }
    } else {
      // Fallback: smoothed chroma (less accurate due to harmonics)
      const maxE = Math.max(...sc);
      if (maxE > 0.01) {
        d.activePCs = sc
          .map((e, i) => ({ e: e / maxE, i }))
          .filter(x => x.e > 0.3)
          .sort((a, b) => b.e - a.e)
          .map(x => x.i);
      } else {
        d.activePCs = [];
      }

      if (d.activePCs.length >= 3 && maxE > 0.01) {
        // Only attempt chord detection with 3+ pitch classes to reduce false positives
        const chord = detectChordFromChroma(sc.map(v => v / maxE));
        if (chord && chord.confidence > 0.75) {
          d.chord = chord;
          d.chordLabel = formatChord(chord);
          d.chordFull = formatChordFull(chord) + ' *';
          d.chordNotes = chord.notes.map(pc => pitchClassName(pc)).join(' - ');
          chordHoldUntil.current = now + HOLD_MS;
        } else if (now > chordHoldUntil.current) {
          d.chord = null;
        }
      } else if (now > chordHoldUntil.current) {
        d.chord = null;
      }
    }

    // Throttled flush to React
    if (now - lastFlush.current >= FLUSH_MS) {
      lastFlush.current = now;
      setDisplay({ ...d });
    }

    rafRef.current = requestAnimationFrame(analyze);
  }, []);

  const startListening = async () => {
    setError(null);
    setConnecting(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      setConnecting(false);
      if (!isLocalhost) {
        setError('Microphone requires HTTPS. Open this page on your laptop at localhost:3000, or use a tunnel (ngrok) for phone access.');
      } else {
        setError('Microphone API not available in this browser.');
      }
      return;
    }

    try {
      unlockAudio();
      if (!detectorRef.current) {
        detectorRef.current = new PitchDetector();
      }
      await detectorRef.current.start();
      setConnecting(false);
      setIsListening(true);
      displayRef.current = emptyDisplay();
      smoothChroma.current = new Array(12).fill(0);
      noteHistory.current = [];
      rafRef.current = requestAnimationFrame(analyze);
    } catch (err) {
      setConnecting(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Microphone permission denied. Tap the lock icon in your browser and allow microphone access.');
      } else if (msg.includes('secure') || msg.includes('HTTPS')) {
        setError('Microphone requires HTTPS. Open localhost:3000 on your laptop, or use ngrok for phone.');
      } else {
        setError(`Microphone error: ${msg}`);
      }
    }
  };

  const stopListening = () => {
    detectorRef.current?.stop();
    cancelAnimationFrame(rafRef.current);
    setIsListening(false);
    setDisplay(emptyDisplay());
  };

  useEffect(() => {
    return () => {
      detectorRef.current?.stop();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Volume bars
  const volumeBars = 8;
  const activeVolumeBars = Math.round(display.volume * volumeBars);

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-4 gap-4">
      <h2 className="text-sm text-amber" style={{ fontFamily: 'var(--font-pixel)' }}>
        LISTEN MODE
      </h2>

      {/* Main display screen */}
      <div className="crt-screen w-full max-w-lg p-6 flex flex-col items-center gap-4 min-h-[280px]">
        {!isListening ? (
          <div className="flex flex-col items-center gap-6 py-8">
            <p className="text-[9px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              {connecting ? 'Connecting to microphone...' : 'Tap to start listening to your piano'}
            </p>
            <button
              onClick={startListening}
              disabled={connecting}
              className={`retro-btn retro-btn-pink retro-btn-big ${connecting ? 'animate-pulse-glow opacity-70' : ''}`}
            >
              {connecting ? 'Connecting...' : 'Start Listening'}
            </button>
          </div>
        ) : (
          <>
            {/* Volume meter */}
            <div className="volume-meter">
              {Array.from({ length: volumeBars }).map((_, i) => (
                <div
                  key={i}
                  className="volume-bar"
                  style={{
                    height: i < activeVolumeBars ? `${((i + 1) / volumeBars) * 24}px` : '3px',
                    background: i < activeVolumeBars
                      ? (i > volumeBars * 0.7 ? '#ff6e6c' : '#23d5ab')
                      : '#241346',
                  }}
                />
              ))}
            </div>

            {/* Detected note — always rendered, visibility toggled via opacity */}
            <div className="text-center transition-opacity duration-200" style={{ opacity: display.hasNote ? 1 : 0.2, minHeight: 60 }}>
              <p className="text-3xl text-pink glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>
                {display.hasNote ? display.noteName : '---'}
              </p>
              {display.hasNote && (
                <p className="text-[8px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                  {display.frequency.toFixed(1)} Hz
                  {' '}
                  <span className={Math.abs(display.centsOff) < 10 ? 'text-green' : 'text-coral'}>
                    {display.centsOff > 0 ? '+' : ''}{display.centsOff.toFixed(0)}¢
                  </span>
                </p>
              )}
            </div>

            {/* Detected chord — always rendered, visibility toggled */}
            <div className="text-center transition-opacity duration-300" style={{ opacity: display.chord ? 1 : 0, minHeight: 50 }}>
              <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>CHORD</p>
              <p className="text-xl text-amber glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>
                {display.chordLabel || '---'}
              </p>
              <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
                {display.chordFull}
              </p>
              <p className="text-[7px] text-teal mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                {display.chordNotes}
              </p>
            </div>

            {/* Detected interval — always rendered */}
            <div className="text-center transition-opacity duration-200" style={{ opacity: display.hasInterval ? 1 : 0, minHeight: 36 }}>
              <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>INTERVAL</p>
              <p className="text-sm text-teal" style={{ fontFamily: 'var(--font-pixel)' }}>
                {display.intervalName || '---'}
              </p>
              <p className="text-[7px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
                {display.intervalFrom} → {display.intervalTo}
              </p>
            </div>

            {/* Stop button */}
            <button
              onClick={stopListening}
              className="retro-btn retro-btn-pink text-[8px] mt-2"
            >
              Stop
            </button>
          </>
        )}

        {error && (
          <p className="text-[8px] text-pink text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
            {error}
          </p>
        )}
      </div>

      {/* Piano keyboard visualization */}
      <div className="w-full max-w-lg overflow-hidden">
        <PianoKeyboard
          startMidi={48}
          endMidi={72}
          activeNotes={display.activePCs}
          activeMode="pitchClass"
        />
      </div>

      {/* Chromagram visualization */}
      {isListening && (
        <div className="w-full max-w-lg">
          <p className="text-[7px] text-cream-dim mb-2 text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
            PITCH ENERGY
          </p>
          <div className="flex justify-between items-end h-16 px-2">
            {NOTE_NAMES.map((name, i) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <div
                  className="w-4 rounded-t"
                  style={{
                    height: `${(display.chroma[i] ?? 0) * 50}px`,
                    background: display.activePCs.includes(i) ? '#ff6e6c' : '#541388',
                    transition: 'height 0.15s ease-out',
                    minHeight: '2px',
                  }}
                />
                <span className="text-[6px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
