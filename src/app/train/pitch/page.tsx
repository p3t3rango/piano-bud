'use client';

import { useState, useCallback } from 'react';
import { playNote, unlockAudio } from '@/lib/audio/synth';
import { midiToNoteName, NOTE_NAMES } from '@/lib/music/theory';
import PianoKeyboard from '@/components/PianoKeyboard';
import InstrumentSelector from '@/components/InstrumentSelector';
import { useExerciseState } from '@/lib/hooks/useExerciseState';

type Difficulty = 1 | 2 | 3;

// Difficulty ranges
// Easy: white notes only (C, D, E, F, G, A, B) in one octave
// Medium: all 12 notes in one octave
// Hard: all notes across 2 octaves
const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B pitch classes

function generateNote(difficulty: Difficulty): number {
  switch (difficulty) {
    case 1: {
      // White notes, octave 3 (C3-B3 in display, MIDI 48-59)
      const pc = WHITE_NOTES[Math.floor(Math.random() * WHITE_NOTES.length)];
      return 48 + pc;
    }
    case 2: {
      // All 12 notes, octave 3
      return 48 + Math.floor(Math.random() * 12);
    }
    case 3: {
      // All notes across 2 octaves (MIDI 48-71)
      return 48 + Math.floor(Math.random() * 24);
    }
  }
}

function getOptions(difficulty: Difficulty): number[] {
  switch (difficulty) {
    case 1:
      return WHITE_NOTES.map(pc => 48 + pc);
    case 2:
      return Array.from({ length: 12 }, (_, i) => 48 + i);
    case 3:
      return Array.from({ length: 24 }, (_, i) => 48 + i);
  }
}

// For the identify mode, show note names as buttons
function getNoteNameOptions(difficulty: Difficulty): { midi: number; name: string }[] {
  switch (difficulty) {
    case 1:
      return WHITE_NOTES.map(pc => ({ midi: 48 + pc, name: midiToNoteName(48 + pc) }));
    case 2:
      return Array.from({ length: 12 }, (_, i) => ({ midi: 48 + i, name: midiToNoteName(48 + i) }));
    case 3:
      // For hard mode, show pitch class names (no octave) to keep grid manageable
      return Array.from({ length: 12 }, (_, i) => ({ midi: 48 + i, name: NOTE_NAMES[i] }));
  }
}

export default function PitchTrainerPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [targetMidi, setTargetMidi] = useState<number | null>(null);
  const [playCount, setPlayCount] = useState(0);
  const { answered, selectedAnswer, score, feedback, instrument, setInstrument,
          submitAnswer, resetForNext, restart: restartScore } = useExerciseState<number>('interval');

  const options = getNoteNameOptions(difficulty);

  const newQuestion = useCallback(() => {
    unlockAudio();
    const midi = generateNote(difficulty);
    setTargetMidi(midi);
    resetForNext();
    setPlayCount(1);
    playNote({ midi, duration: 1.5, instrument, volume: 0.35 });
  }, [difficulty, instrument, resetForNext]);

  const replay = () => {
    if (!targetMidi) return;
    playNote({ midi: targetMidi, duration: 1.5, instrument, volume: 0.35 });
    setPlayCount(prev => prev + 1);
  };

  const handleAnswer = (answerMidi: number) => {
    if (answered || targetMidi === null) return;
    // For hard mode (2 octaves), match by pitch class since options only show pitch classes
    const correct = difficulty === 3
      ? (answerMidi % 12) === (targetMidi % 12)
      : answerMidi === targetMidi;

    submitAnswer(answerMidi, correct, `pitch:${midiToNoteName(targetMidi)}`);

    // Play the correct note if wrong
    if (!correct) {
      setTimeout(() => {
        playNote({ midi: targetMidi, duration: 1, instrument, volume: 0.3 });
      }, 600);
    }
  };

  const restart = () => {
    restartScore();
    setTargetMidi(null);
  };

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-4 gap-4">
      <h2 className="text-sm text-coral" style={{ fontFamily: 'var(--font-pixel)' }}>
        PERFECT PITCH
      </h2>

      {/* Settings */}
      <div className="flex gap-2 flex-wrap justify-center">
        {([1, 2, 3] as Difficulty[]).map(d => (
          <button
            key={d}
            onClick={() => { setDifficulty(d); setTargetMidi(null); }}
            className={`badge ${d === 1 ? 'badge-easy' : d === 2 ? 'badge-medium' : 'badge-hard'} ${difficulty === d ? 'ring-1 ring-current' : 'opacity-50'}`}
          >
            {d === 1 ? 'White Keys' : d === 2 ? 'All Notes' : '2 Octaves'}
          </button>
        ))}
      </div>

      {/* Instrument & restart */}
      <div className="flex gap-2 flex-wrap justify-center items-center">
        <InstrumentSelector value={instrument} onChange={setInstrument} />
        {score.total > 0 && (
          <button onClick={restart} className="badge badge-hard">
            Restart
          </button>
        )}
      </div>

      {/* Score */}
      {score.total > 0 && (
        <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
          {score.correct}/{score.total} correct ({Math.round((score.correct / score.total) * 100)}%)
        </p>
      )}

      {/* Question area */}
      <div className="crt-screen w-full max-w-lg p-6 flex flex-col items-center gap-4 min-h-[140px]">
        {!targetMidi ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-[9px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              Listen to a note and identify it
            </p>
            <p className="text-[7px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              No reference note given — trust your ear
            </p>
            <button onClick={newQuestion} className="retro-btn retro-btn-coral retro-btn-big">
              Start
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-3 items-center">
              <button onClick={replay} className="retro-btn retro-btn-amber text-[8px]">
                Replay ({playCount})
              </button>
            </div>

            {answered && (
              <div className="text-center">
                {(difficulty === 3
                  ? (selectedAnswer! % 12) === (targetMidi % 12)
                  : selectedAnswer === targetMidi
                ) ? (
                  <p className="text-sm text-green glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>CORRECT!</p>
                ) : (
                  <div>
                    <p className="text-sm text-pink" style={{ fontFamily: 'var(--font-pixel)' }}>NOPE!</p>
                    <p className="text-[8px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                      It was: <span className="text-amber">{midiToNoteName(targetMidi)}</span>
                    </p>
                  </div>
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

      {/* Answer buttons */}
      {targetMidi && (
        <div className={`grid gap-2 w-full max-w-lg ${options.length <= 7 ? 'grid-cols-4' : 'grid-cols-4'}`}>
          {options.map(opt => {
            const isCorrect = difficulty === 3
              ? (opt.midi % 12) === (targetMidi % 12)
              : opt.midi === targetMidi;
            const isSelected = difficulty === 3
              ? selectedAnswer !== null && (selectedAnswer % 12) === (opt.midi % 12)
              : selectedAnswer === opt.midi;

            let className = 'option-btn';
            if (answered) {
              if (isCorrect) className += ' correct';
              else if (isSelected) className += ' incorrect';
            }
            return (
              <button
                key={opt.midi}
                onClick={() => handleAnswer(opt.midi)}
                className={className}
                disabled={answered}
              >
                <div className="text-[10px]">{opt.name}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Next button */}
      {answered && (
        <button onClick={newQuestion} className="retro-btn retro-btn-teal retro-btn-big">
          Next
        </button>
      )}

      {/* Keyboard showing the answer */}
      {targetMidi && answered && (
        <div className="w-full max-w-lg mt-2">
          <PianoKeyboard
            startMidi={46}
            endMidi={73}
            activeNotes={[targetMidi]}
            activeMode="midi"
          />
        </div>
      )}
    </div>
  );
}
