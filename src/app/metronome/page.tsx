'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  playMetronomeBeat, unlockAudio,
  METRONOME_SOUNDS, type MetronomeSound, type BeatLevel,
} from '@/lib/audio/synth';

const MIN_BPM = 30;
const MAX_BPM = 240;

const TIME_SIGS = [
  { beats: 2, label: '2/4' },
  { beats: 3, label: '3/4' },
  { beats: 4, label: '4/4' },
  { beats: 5, label: '5/4' },
  { beats: 6, label: '6/8' },
  { beats: 7, label: '7/8' },
];

function bpmToLabel(bpm: number): string {
  if (bpm <= 45) return 'Grave';
  if (bpm <= 60) return 'Largo';
  if (bpm <= 72) return 'Adagio';
  if (bpm <= 85) return 'Andantino';
  if (bpm <= 100) return 'Andante';
  if (bpm <= 115) return 'Moderato';
  if (bpm <= 130) return 'Allegretto';
  if (bpm <= 155) return 'Allegro';
  if (bpm <= 175) return 'Vivace';
  if (bpm <= 200) return 'Presto';
  return 'Prestissimo';
}

export default function MetronomePage() {
  const [bpm, setBpm] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [timeSigIndex, setTimeSigIndex] = useState(2); // default 4/4
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [sound, setSound] = useState<MetronomeSound>('click');
  const [beatLevels, setBeatLevels] = useState<BeatLevel[]>([2, 1, 1, 1]);
  const [tapTimes, setTapTimes] = useState<number[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatRef = useRef(0);
  const bpmRef = useRef(bpm);
  const beatLevelsRef = useRef(beatLevels);
  const soundRef = useRef(sound);

  // Keep refs in sync
  bpmRef.current = bpm;
  beatLevelsRef.current = beatLevels;
  soundRef.current = sound;

  const timeSig = TIME_SIGS[timeSigIndex];

  // Update beat levels when time sig changes
  useEffect(() => {
    setBeatLevels(prev => {
      const newLevels: BeatLevel[] = Array.from({ length: timeSig.beats }, (_, i) => {
        if (i < prev.length) return prev[i];
        return i === 0 ? 2 : 1;
      });
      return newLevels.slice(0, timeSig.beats);
    });
  }, [timeSig.beats]);

  const tick = useCallback(() => {
    const beat = beatRef.current;
    const level = beatLevelsRef.current[beat] ?? 1;
    playMetronomeBeat(level, soundRef.current);
    setCurrentBeat(beat);
    beatRef.current = (beat + 1) % beatLevelsRef.current.length;
  }, []);

  const startMetronome = useCallback(() => {
    unlockAudio();
    beatRef.current = 0;
    tick();

    const ms = (60 / bpmRef.current) * 1000;
    intervalRef.current = setInterval(() => {
      tick();
    }, ms);
    setPlaying(true);
  }, [tick]);

  const stopMetronome = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(false);
    setCurrentBeat(-1);
  }, []);

  const restartMetronome = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    beatRef.current = 0;
    tick();
    const ms = (60 / bpmRef.current) * 1000;
    intervalRef.current = setInterval(() => {
      tick();
    }, ms);
  }, [tick]);

  // Restart interval when BPM changes while playing (debounced to avoid rapid restarts during dial drag)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!playing) return;
    // Don't restart immediately — just update the interval timing
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const ms = (60 / bpmRef.current) * 1000;
      intervalRef.current = setInterval(() => {
        tick();
      }, ms);
    }, 150);
  }, [bpm]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Toggle a beat's accent level: off → normal → accent → off
  const cycleBeatLevel = (index: number) => {
    setBeatLevels(prev => {
      const next = [...prev];
      next[index] = ((next[index] + 1) % 3) as BeatLevel;
      return next;
    });
  };

  // ── Dial touch handling ──
  const dialRef = useRef<HTMLDivElement>(null);
  const lastAngleRef = useRef<number | null>(null);

  const getAngle = (clientX: number, clientY: number): number => {
    if (!dialRef.current) return 0;
    const rect = dialRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx);
  };

  const handleDialStart = (clientX: number, clientY: number) => {
    lastAngleRef.current = getAngle(clientX, clientY);
  };

  const handleDialMove = (clientX: number, clientY: number) => {
    if (lastAngleRef.current === null) return;
    const angle = getAngle(clientX, clientY);
    let delta = angle - lastAngleRef.current;
    // Handle wrap-around
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    // Map radians to BPM (full rotation ≈ 100 BPM)
    const bpmDelta = (delta / (2 * Math.PI)) * 100;
    setBpm(prev => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(prev + bpmDelta))));
    lastAngleRef.current = angle;
  };

  const handleDialEnd = () => {
    lastAngleRef.current = null;
  };

  // ── Tap tempo ──
  const handleTapTempo = () => {
    unlockAudio();
    playMetronomeBeat(1, sound);
    const now = Date.now();
    setTapTimes(prev => {
      const recent = [...prev, now].filter(t => now - t < 4000); // last 4 seconds
      if (recent.length >= 2) {
        const intervals = [];
        for (let i = 1; i < recent.length; i++) {
          intervals.push(recent[i] - recent[i - 1]);
        }
        const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const tapBpm = Math.round(60000 / avgMs);
        if (tapBpm >= MIN_BPM && tapBpm <= MAX_BPM) {
          setBpm(tapBpm);
        }
      }
      return recent;
    });
  };

  // Dial rotation visual (maps BPM to angle)
  const dialRotation = ((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 300 - 150; // -150 to +150 degrees

  // Notch marks around the dial
  const notchCount = 40;

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-3 gap-3">
      {/* CRT Display */}
      <div className="crt-screen w-full max-w-sm p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="text-[7px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
              TEMPO (BPM)
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl text-teal" style={{ fontFamily: 'var(--font-pixel)' }}>
                {bpm}
              </span>
              <span className="text-[8px] text-coral" style={{ fontFamily: 'var(--font-pixel)' }}>
                {bpmToLabel(bpm)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[7px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>T.S.</p>
            <p className="text-xl text-amber mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
              {timeSig.label}
            </p>
          </div>
        </div>

        {/* Beat indicators with accent levels */}
        <div className="flex gap-2 justify-center">
          {beatLevels.map((level, i) => (
            <button
              key={i}
              onClick={() => cycleBeatLevel(i)}
              className="flex flex-col gap-[3px] items-center p-1 rounded"
              style={{ flex: 1, maxWidth: 60 }}
            >
              {/* 3 rows: accent, normal, off indicator */}
              {([2, 1] as const).map(row => (
                <div
                  key={row}
                  className="w-full rounded-sm transition-all duration-100"
                  style={{
                    height: 16,
                    background:
                      level >= row
                        ? i === currentBeat && playing
                          ? (row === 2 ? '#ff6e6c' : '#ffd93d')
                          : (row === 2 ? 'rgba(255,110,108,0.4)' : 'rgba(255,217,61,0.3)')
                        : 'rgba(84,19,136,0.3)',
                    boxShadow:
                      level >= row && i === currentBeat && playing
                        ? `0 0 8px ${row === 2 ? '#ff6e6c' : '#ffd93d'}`
                        : 'none',
                    border: '1px solid rgba(84,19,136,0.5)',
                  }}
                />
              ))}
              {/* Beat number */}
              <span
                className="text-[7px] mt-1"
                style={{
                  fontFamily: 'var(--font-pixel)',
                  color: i === currentBeat && playing ? '#23d5ab' : '#b8a88a',
                }}
              >
                {i + 1}
              </span>
            </button>
          ))}
        </div>

        <p className="text-[6px] text-cream-dim text-center mt-2" style={{ fontFamily: 'var(--font-pixel)' }}>
          TAP BEATS TO SET ACCENT
        </p>
      </div>

      {/* Sound & Time Sig selectors */}
      <div className="flex gap-2 flex-wrap justify-center">
        {METRONOME_SOUNDS.map(s => (
          <button
            key={s.id}
            onClick={() => { setSound(s.id); unlockAudio(); playMetronomeBeat(2, s.id); }}
            className={`badge ${sound === s.id ? 'badge-easy ring-1 ring-current' : 'badge-easy opacity-50'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {TIME_SIGS.map((ts, i) => (
          <button
            key={ts.label}
            onClick={() => setTimeSigIndex(i)}
            className={`badge ${i === timeSigIndex ? 'badge-medium ring-1 ring-current' : 'badge-medium opacity-50'}`}
          >
            {ts.label}
          </button>
        ))}
      </div>

      {/* Dial */}
      <div className="relative" style={{ width: 240, height: 240 }}>
        {/* Notch marks */}
        {Array.from({ length: notchCount }).map((_, i) => {
          const angle = (i / notchCount) * 360;
          const isLong = i % 5 === 0;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                width: 2,
                height: isLong ? 12 : 6,
                background: isLong ? '#8b6f47' : '#5a4530',
                top: '50%',
                left: '50%',
                transformOrigin: '50% 0',
                transform: `rotate(${angle}deg) translateY(-115px)`,
              }}
            />
          );
        })}

        {/* Dial circle */}
        <div
          ref={dialRef}
          className="absolute rounded-full cursor-grab active:cursor-grabbing"
          style={{
            width: 200,
            height: 200,
            top: 20,
            left: 20,
            background: 'radial-gradient(circle at 40% 35%, #3a2a50, #1a0a2e 70%)',
            border: '3px solid #541388',
            boxShadow: '0 0 20px rgba(84,19,136,0.4), inset 0 0 30px rgba(0,0,0,0.5)',
            touchAction: 'none',
          }}
          onTouchStart={e => {
            const t = e.touches[0];
            handleDialStart(t.clientX, t.clientY);
          }}
          onTouchMove={e => {
            const t = e.touches[0];
            handleDialMove(t.clientX, t.clientY);
          }}
          onTouchEnd={handleDialEnd}
          onMouseDown={e => handleDialStart(e.clientX, e.clientY)}
          onMouseMove={e => { if (e.buttons) handleDialMove(e.clientX, e.clientY); }}
          onMouseUp={handleDialEnd}
          onMouseLeave={handleDialEnd}
        >
          {/* Dial indicator notch */}
          <div
            className="absolute"
            style={{
              width: 4,
              height: 20,
              background: '#23d5ab',
              borderRadius: 2,
              top: 10,
              left: '50%',
              marginLeft: -2,
              transform: `rotate(${dialRotation}deg)`,
              transformOrigin: `50% ${100 - 10}px`,
              boxShadow: '0 0 6px #23d5ab',
            }}
          />

          {/* Play/Pause button in center */}
          <button
            onClick={playing ? stopMetronome : startMetronome}
            className="absolute rounded-full flex items-center justify-center"
            style={{
              width: 70,
              height: 70,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(circle at 40% 35%, #4a3a60, #241346)',
              border: '2px solid #541388',
              boxShadow: playing
                ? '0 0 15px rgba(35,213,171,0.5), inset 0 0 10px rgba(0,0,0,0.3)'
                : '0 0 10px rgba(84,19,136,0.3), inset 0 0 10px rgba(0,0,0,0.3)',
            }}
          >
            {playing ? (
              <div className="flex gap-[4px]">
                <div className="w-[6px] h-[18px] bg-pink rounded-sm" />
                <div className="w-[6px] h-[18px] bg-pink rounded-sm" />
              </div>
            ) : (
              <div
                className="ml-1"
                style={{
                  width: 0,
                  height: 0,
                  borderTop: '12px solid transparent',
                  borderBottom: '12px solid transparent',
                  borderLeft: '18px solid #23d5ab',
                }}
              />
            )}
          </button>
        </div>
      </div>

      {/* Tap Tempo button */}
      <button
        onClick={handleTapTempo}
        className="retro-btn retro-btn-amber retro-btn-big"
        style={{ minWidth: 200 }}
      >
        TAP TEMPO
      </button>
    </div>
  );
}
