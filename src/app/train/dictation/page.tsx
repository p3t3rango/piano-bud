'use client';

import { useCallback, useMemo, useState } from 'react';
import PianoKeyboard from '@/components/PianoKeyboard';
import InstrumentSelector from '@/components/InstrumentSelector';
import { playNote, unlockAudio } from '@/lib/audio/synth';
import { midiToNoteName, pitchClassName } from '@/lib/music/theory';
import { useExerciseState } from '@/lib/hooks/useExerciseState';
import { useKeyShortcut } from '@/lib/hooks/useAnswerShortcuts';

type Difficulty = 1 | 2 | 3;

// Diatonic scale intervals
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

interface Melody {
  rootMidi: number;
  rootPc: number;
  scaleName: 'Major' | 'Minor';
  scale: number[];     // Interval set
  notes: number[];     // MIDI notes of the melody
}

function generateMelody(difficulty: Difficulty): Melody {
  let length: number;
  let scaleIntervals: number[];
  let scaleName: 'Major' | 'Minor';
  let rootMidi: number;

  switch (difficulty) {
    case 1:
      // 3 notes, C major, one octave
      length = 3;
      scaleIntervals = MAJOR;
      scaleName = 'Major';
      rootMidi = 60; // C4
      break;
    case 2:
      // 4 notes, random major key, one octave
      length = 4;
      scaleIntervals = MAJOR;
      scaleName = 'Major';
      rootMidi = 55 + Math.floor(Math.random() * 12); // G3..F#4
      break;
    case 3: {
      // 5 notes, random key + mode
      length = 5;
      const minor = Math.random() < 0.5;
      scaleIntervals = minor ? NATURAL_MINOR : MAJOR;
      scaleName = minor ? 'Minor' : 'Major';
      rootMidi = 55 + Math.floor(Math.random() * 12);
      break;
    }
  }

  // Build 2-octave scale pool centered on root
  const pool: number[] = [];
  for (const oct of [-1, 0, 1]) {
    for (const iv of scaleIntervals) {
      pool.push(rootMidi + oct * 12 + iv);
    }
  }

  // Random walk starting on tonic, next step within ±4 scale positions
  const notes: number[] = [rootMidi];
  const startIdx = pool.indexOf(rootMidi);
  let idx = startIdx;
  for (let i = 1; i < length; i++) {
    const maxStep = difficulty === 1 ? 2 : difficulty === 2 ? 3 : 4;
    const step = Math.floor(Math.random() * (2 * maxStep + 1)) - maxStep;
    idx = Math.max(0, Math.min(pool.length - 1, idx + (step || 1)));
    notes.push(pool[idx]);
  }

  return {
    rootMidi,
    rootPc: ((rootMidi % 12) + 12) % 12,
    scaleName,
    scale: scaleIntervals,
    notes,
  };
}

function playMelody(midis: number[], instrument: Parameters<typeof playNote>[0]['instrument']): void {
  const gap = 550; // ms between note starts
  midis.forEach((m, i) => {
    setTimeout(() => playNote({ midi: m, duration: 0.5, instrument, volume: 0.35 }), i * gap);
  });
}

export default function DictationTrainerPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [melody, setMelody] = useState<Melody | null>(null);
  const [entered, setEntered] = useState<number[]>([]);

  // Reuse the standard exercise scaffolding. selectedAnswer is unused here
  // (we compare sequences) but we still get score/feedback/instrument.
  const { answered, score, feedback, instrument, setInstrument,
          submitAnswer, resetForNext, restart: restartScore } = useExerciseState<number[]>('interval');

  const newQuestion = useCallback(() => {
    unlockAudio();
    const m = generateMelody(difficulty);
    setMelody(m);
    setEntered([]);
    resetForNext();
    playMelody(m.notes, instrument);
  }, [difficulty, instrument, resetForNext]);

  const restart = () => {
    restartScore();
    setMelody(null);
    setEntered([]);
  };

  const replay = () => {
    if (!melody) return;
    playMelody(melody.notes, instrument);
  };

  const handleKeyTap = (midi: number) => {
    if (answered || !melody) return;
    playNote({ midi, duration: 0.35, instrument, volume: 0.35 });
    const next = [...entered, midi];
    setEntered(next);
    if (next.length === melody.notes.length) {
      // All notes entered — compare
      const correct = next.every((m, i) => m === melody.notes[i]);
      const itemName = `dictation:${melody.scaleName}-${melody.notes.length}notes`;
      submitAnswer(next, correct, itemName);
      // After a short beat, replay the correct melody
      setTimeout(() => playMelody(melody.notes, instrument), 700);
    }
  };

  const undo = () => {
    if (answered) return;
    setEntered(prev => prev.slice(0, -1));
  };

  useKeyShortcut('Enter', newQuestion, !!melody && !answered);
  useKeyShortcut('r', replay, !melody);
  useKeyShortcut('Backspace', undo, answered || !melody || entered.length === 0);

  // Build display: active keys show what the user has entered so far
  // (and the correct answer after submission for comparison).
  const keyboardRange = useMemo(() => {
    if (!melody) return { start: 55, end: 79 };
    const all = [...melody.notes, ...entered];
    const min = Math.min(...all);
    const max = Math.max(...all);
    return { start: min - 4, end: max + 4 };
  }, [melody, entered]);

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-4 gap-4">
      <h2 className="text-sm text-teal" style={{ fontFamily: 'var(--font-pixel)' }}>
        MELODIC DICTATION
      </h2>

      {/* Difficulty */}
      <div className="flex gap-2">
        {([1, 2, 3] as Difficulty[]).map(d => (
          <button
            key={d}
            onClick={() => { setDifficulty(d); setMelody(null); setEntered([]); }}
            className={`badge ${d === 1 ? 'badge-easy' : d === 2 ? 'badge-medium' : 'badge-hard'} ${difficulty === d ? 'ring-1 ring-current' : 'opacity-50'}`}
          >
            {d === 1 ? '3 notes' : d === 2 ? '4 notes' : '5 notes'}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap justify-center items-center">
        <InstrumentSelector value={instrument} onChange={setInstrument} />
        {score.total > 0 && <button onClick={restart} className="badge badge-hard">Restart</button>}
      </div>

      {/* Score */}
      {score.total > 0 && (
        <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
          {score.correct}/{score.total} correct ({Math.round((score.correct / score.total) * 100)}%)
        </p>
      )}

      {/* Question area */}
      <div className="crt-screen w-full max-w-lg p-6 flex flex-col items-center gap-3 min-h-[160px]">
        {!melody ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-[9px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              Listen to a melody, then tap it on the keyboard
            </p>
            <button onClick={newQuestion} className="retro-btn retro-btn-teal retro-btn-big">
              Start
            </button>
          </div>
        ) : (
          <>
            <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
              KEY: <span className="text-teal">{pitchClassName(melody.rootPc)} {melody.scaleName}</span>
            </p>

            <div className="flex gap-2">
              <button onClick={replay} className="retro-btn retro-btn-amber text-[8px]">
                ♫ Replay
              </button>
              {!answered && entered.length > 0 && (
                <button onClick={undo} className="retro-btn retro-btn-pink text-[8px]">
                  ← Undo
                </button>
              )}
            </div>

            <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
              {entered.length} / {melody.notes.length} entered
            </p>

            {!answered && (
              <p className="text-[7px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
                Tap the piano below to enter each note.
              </p>
            )}

            {answered && (
              <div className="text-center">
                {entered.every((m, i) => m === melody.notes[i]) ? (
                  <p className="text-sm text-green glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>CORRECT!</p>
                ) : (
                  <>
                    <p className="text-sm text-pink" style={{ fontFamily: 'var(--font-pixel)' }}>NOPE!</p>
                    <p className="text-[7px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                      You: <span className="text-amber">{entered.map(midiToNoteName).join(' ')}</span>
                    </p>
                    <p className="text-[7px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                      Answer: <span className="text-teal">{melody.notes.map(midiToNoteName).join(' ')}</span>
                    </p>
                  </>
                )}
                {feedback && feedback.xp > 0 && (
                  <p className="text-[8px] text-teal mt-1 note-float" style={{ fontFamily: 'var(--font-pixel)' }}>
                    +{feedback.xp} XP
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Interactive keyboard */}
      {melody && (
        <div className="w-full max-w-lg">
          <PianoKeyboard
            startMidi={keyboardRange.start}
            endMidi={keyboardRange.end}
            activeNotes={answered ? melody.notes : entered}
            activeMode="midi"
            onKeyPress={handleKeyTap}
          />
        </div>
      )}

      {answered && (
        <button onClick={newQuestion} className="retro-btn retro-btn-teal retro-btn-big">
          Next →
        </button>
      )}
    </div>
  );
}
