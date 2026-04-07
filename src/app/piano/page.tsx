'use client';

import { useState, useCallback } from 'react';
import { playNote, unlockAudio, INSTRUMENTS, type Instrument } from '@/lib/audio/synth';
import { midiToNoteName, isBlackKey, midiToPitchClass } from '@/lib/music/theory';

export default function PianoPage() {
  const [instrument, setInstrument] = useState<Instrument>('piano');
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [octave, setOctave] = useState(4); // C4 to C5 default

  const startMidi = octave * 12 + 12; // C of current octave (C4 = 60)
  const endMidi = startMidi + 24; // Two octaves

  const handleKeyDown = useCallback((midi: number) => {
    unlockAudio();
    playNote({ midi, duration: 2, instrument, volume: 0.4 });
    setActiveKeys(prev => new Set(prev).add(midi));
    setTimeout(() => {
      setActiveKeys(prev => {
        const next = new Set(prev);
        next.delete(midi);
        return next;
      });
    }, 300);
  }, [instrument]);

  // Build key layout
  const whiteKeys: number[] = [];
  const blackKeyPositions: { midi: number; leftIndex: number }[] = [];

  let whiteIndex = 0;
  for (let midi = startMidi; midi <= endMidi; midi++) {
    if (!isBlackKey(midi)) {
      whiteKeys.push(midi);
      whiteIndex++;
    } else {
      blackKeyPositions.push({ midi, leftIndex: whiteIndex });
    }
  }

  const keyWidth = Math.min(48, Math.floor((typeof window !== 'undefined' ? window.innerWidth - 32 : 360) / whiteKeys.length));
  const blackKeyWidth = Math.floor(keyWidth * 0.65);
  const whiteKeyHeight = 180;
  const blackKeyHeight = 110;
  const totalWidth = whiteKeys.length * keyWidth;

  return (
    <div className="flex flex-col items-center flex-1 px-2 py-4 gap-4">
      <h2 className="text-sm text-amber" style={{ fontFamily: 'var(--font-pixel)' }}>
        PIANO
      </h2>

      {/* Instrument selector */}
      <div className="flex gap-2 flex-wrap justify-center">
        {INSTRUMENTS.map(inst => (
          <button
            key={inst.id}
            onClick={() => setInstrument(inst.id)}
            className={`badge ${instrument === inst.id ? 'badge-medium ring-1 ring-current' : 'badge-medium opacity-50'}`}
          >
            {inst.label}
          </button>
        ))}
      </div>

      {/* Octave selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOctave(o => Math.max(1, o - 1))}
          className="retro-btn text-[10px] px-4 py-2"
        >
          ◀
        </button>
        <span className="text-[9px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
          C{octave} — C{octave + 2}
        </span>
        <button
          onClick={() => setOctave(o => Math.min(6, o + 1))}
          className="retro-btn text-[10px] px-4 py-2"
        >
          ▶
        </button>
      </div>

      {/* Piano keyboard */}
      <div className="crt-screen p-4 w-full overflow-x-auto flex justify-center">
        <div className="relative" style={{ width: totalWidth, height: whiteKeyHeight }}>
          {/* White keys */}
          {whiteKeys.map((midi, i) => {
            const active = activeKeys.has(midi);
            const isC = midiToPitchClass(midi) === 0;
            return (
              <button
                key={midi}
                onTouchStart={(e) => { e.preventDefault(); handleKeyDown(midi); }}
                onMouseDown={() => handleKeyDown(midi)}
                className="absolute top-0 rounded-b-md border border-gray-300 transition-colors duration-100"
                style={{
                  left: i * keyWidth,
                  width: keyWidth - 1,
                  height: whiteKeyHeight,
                  background: active ? '#ff6e6c' : '#f5f0e8',
                  boxShadow: active
                    ? '0 0 12px rgba(255,110,108,0.6)'
                    : 'inset -1px -2px 3px rgba(0,0,0,0.1)',
                  zIndex: 1,
                }}
              >
                <span
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[7px] select-none"
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    color: active ? '#fff' : '#999',
                  }}
                >
                  {isC ? midiToNoteName(midi) : ''}
                </span>
              </button>
            );
          })}

          {/* Black keys */}
          {blackKeyPositions.map(({ midi, leftIndex }) => {
            const active = activeKeys.has(midi);
            return (
              <button
                key={midi}
                onTouchStart={(e) => { e.preventDefault(); handleKeyDown(midi); }}
                onMouseDown={() => handleKeyDown(midi)}
                className="absolute top-0 rounded-b transition-colors duration-100"
                style={{
                  left: (leftIndex - 1) * keyWidth + keyWidth - blackKeyWidth / 2,
                  width: blackKeyWidth,
                  height: blackKeyHeight,
                  background: active ? '#ff6e6c' : '#1a1a2e',
                  boxShadow: active
                    ? '0 0 12px rgba(255,110,108,0.6)'
                    : '0 2px 4px rgba(0,0,0,0.5)',
                  zIndex: 3,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Current note display */}
      {activeKeys.size > 0 && (
        <p className="text-lg text-pink glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>
          {Array.from(activeKeys).map(m => midiToNoteName(m)).join(' ')}
        </p>
      )}
    </div>
  );
}
