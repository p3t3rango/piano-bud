'use client';

import { useState, useCallback } from 'react';
import { getChordsByDifficulty, type ChordDef } from '@/lib/music/chords';
import { playChord, unlockAudio } from '@/lib/audio/synth';
import { pitchClassName } from '@/lib/music/theory';
import PianoKeyboard from '@/components/PianoKeyboard';
import InstrumentSelector from '@/components/InstrumentSelector';
import { useExerciseState } from '@/lib/hooks/useExerciseState';

type Difficulty = 1 | 2 | 3;

interface Question {
  rootMidi: number;
  rootPc: number;
  chordType: ChordDef;
  midiNotes: number[];
}

function generateQuestion(difficulty: Difficulty): Question {
  const types = getChordsByDifficulty(difficulty);
  const chordType = types[Math.floor(Math.random() * types.length)];
  const rootMidi = 48 + Math.floor(Math.random() * 12); // C3 to B3
  const rootPc = rootMidi % 12;
  const midiNotes = chordType.intervals.map(i => rootMidi + i);
  return { rootMidi, rootPc, chordType, midiNotes };
}

export default function ChordTrainerPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [question, setQuestion] = useState<Question | null>(null);
  const { answered, selectedAnswer, score, feedback, instrument, setInstrument,
          submitAnswer, resetForNext, restart: restartScore } = useExerciseState<string>('chord');

  const options = getChordsByDifficulty(difficulty);

  const newQuestion = useCallback(() => {
    unlockAudio();
    const q = generateQuestion(difficulty);
    setQuestion(q);
    resetForNext();
    playChord(q.midiNotes, 1.5, instrument);
  }, [difficulty, instrument, resetForNext]);

  const restart = () => {
    restartScore();
    setQuestion(null);
  };

  const handleAnswer = (shortName: string) => {
    if (answered || !question) return;
    const correct = shortName === question.chordType.shortName;
    submitAnswer(shortName, correct, question.chordType.name);
  };

  const replayQuestion = () => {
    if (!question) return;
    playChord(question.midiNotes, 1.5, instrument);
  };

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-4 gap-4">
      <h2 className="text-sm text-amber" style={{ fontFamily: 'var(--font-pixel)' }}>
        CHORDS
      </h2>

      {/* Difficulty */}
      <div className="flex gap-2">
        {([1, 2, 3] as Difficulty[]).map(d => (
          <button
            key={d}
            onClick={() => { setDifficulty(d); setQuestion(null); }}
            className={`badge ${d === 1 ? 'badge-easy' : d === 2 ? 'badge-medium' : 'badge-hard'} ${difficulty === d ? 'ring-1 ring-current' : 'opacity-50'}`}
          >
            {d === 1 ? 'Easy' : d === 2 ? 'Medium' : 'Hard'}
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
      <div className="crt-screen w-full max-w-lg p-6 flex flex-col items-center gap-4 min-h-[160px]">
        {!question ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-[9px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              Listen and identify the chord quality
            </p>
            <button onClick={newQuestion} className="retro-btn retro-btn-amber retro-btn-big">
              Start
            </button>
          </div>
        ) : (
          <>
            {/* Root note displayed */}
            <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
              ROOT: <span className="text-amber">{pitchClassName(question.rootPc)}</span>
            </p>

            <button onClick={replayQuestion} className="retro-btn retro-btn-amber text-[8px]">
              ♫ Replay
            </button>

            {answered && (
              <div className="text-center">
                {selectedAnswer === question.chordType.shortName ? (
                  <p className="text-sm text-green glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>CORRECT!</p>
                ) : (
                  <div>
                    <p className="text-sm text-pink" style={{ fontFamily: 'var(--font-pixel)' }}>NOPE!</p>
                    <p className="text-[8px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                      It was: <span className="text-amber">{pitchClassName(question.rootPc)} {question.chordType.name}</span>
                    </p>
                  </div>
                )}
                <p className="text-[7px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                  Notes: {question.midiNotes.map(m => pitchClassName(m % 12)).join(' - ')}
                </p>
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

      {/* Answer options */}
      {question && (
        <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
          {options.map(chord => {
            let className = 'option-btn';
            if (answered) {
              if (chord.shortName === question.chordType.shortName) {
                className += ' correct';
              } else if (chord.shortName === selectedAnswer) {
                className += ' incorrect';
              }
            }
            return (
              <button
                key={chord.shortName}
                onClick={() => handleAnswer(chord.shortName)}
                className={className}
                disabled={answered}
              >
                <div>
                  <div className="text-[10px]">{chord.name}</div>
                  <div className="text-[7px] opacity-60 mt-1">{chord.shortName}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {answered && (
        <button onClick={newQuestion} className="retro-btn retro-btn-teal retro-btn-big">
          Next →
        </button>
      )}

      {question && answered && (
        <div className="w-full max-w-lg mt-2">
          <PianoKeyboard
            startMidi={question.rootMidi - 2}
            endMidi={question.rootMidi + 16}
            activeNotes={question.midiNotes}
            activeMode="midi"
          />
        </div>
      )}
    </div>
  );
}
