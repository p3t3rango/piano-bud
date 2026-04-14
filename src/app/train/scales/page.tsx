'use client';

import { useState, useCallback } from 'react';
import { getScalesByDifficulty, type ScaleDef } from '@/lib/music/scales';
import { playScale, unlockAudio } from '@/lib/audio/synth';
import { pitchClassName } from '@/lib/music/theory';
import PianoKeyboard from '@/components/PianoKeyboard';
import InstrumentSelector from '@/components/InstrumentSelector';
import { useExerciseState } from '@/lib/hooks/useExerciseState';

type Difficulty = 1 | 2 | 3;

interface Question {
  rootMidi: number;
  rootPc: number;
  scale: ScaleDef;
}

function generateQuestion(difficulty: Difficulty): Question {
  const scales = getScalesByDifficulty(difficulty);
  const scale = scales[Math.floor(Math.random() * scales.length)];
  const rootMidi = 48 + Math.floor(Math.random() * 12);
  return { rootMidi, rootPc: rootMidi % 12, scale };
}

export default function ScaleTrainerPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [question, setQuestion] = useState<Question | null>(null);
  const { answered, selectedAnswer, score, feedback, instrument, setInstrument,
          submitAnswer, resetForNext, restart: restartScore } = useExerciseState<string>('scale');

  const options = getScalesByDifficulty(difficulty);

  const newQuestion = useCallback(() => {
    unlockAudio();
    const q = generateQuestion(difficulty);
    setQuestion(q);
    resetForNext();
    playScale(q.rootMidi, q.scale.intervals, 250, instrument);
  }, [difficulty, instrument, resetForNext]);

  const restart = () => {
    restartScore();
    setQuestion(null);
  };

  const handleAnswer = (name: string) => {
    if (answered || !question) return;
    const correct = name === question.scale.name;
    submitAnswer(name, correct, question.scale.name);
  };

  const replayQuestion = () => {
    if (!question) return;
    playScale(question.rootMidi, question.scale.intervals, 250, instrument);
  };

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-4 gap-4">
      <h2 className="text-sm text-teal" style={{ fontFamily: 'var(--font-pixel)' }}>
        SCALES
      </h2>

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

      {score.total > 0 && (
        <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
          {score.correct}/{score.total} correct ({Math.round((score.correct / score.total) * 100)}%)
        </p>
      )}

      <div className="crt-screen w-full max-w-lg p-6 flex flex-col items-center gap-4 min-h-[160px]">
        {!question ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-[9px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              Listen and identify the scale
            </p>
            <button onClick={newQuestion} className="retro-btn retro-btn-teal retro-btn-big">
              Start
            </button>
          </div>
        ) : (
          <>
            <p className="text-[8px] text-cream-dim" style={{ fontFamily: 'var(--font-pixel)' }}>
              ROOT: <span className="text-teal">{pitchClassName(question.rootPc)}</span>
            </p>

            <button onClick={replayQuestion} className="retro-btn retro-btn-amber text-[8px]">
              ♫ Replay
            </button>

            {answered && (
              <div className="text-center">
                {selectedAnswer === question.scale.name ? (
                  <p className="text-sm text-green glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>CORRECT!</p>
                ) : (
                  <div>
                    <p className="text-sm text-pink" style={{ fontFamily: 'var(--font-pixel)' }}>NOPE!</p>
                    <p className="text-[8px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                      It was: <span className="text-teal">{pitchClassName(question.rootPc)} {question.scale.name}</span>
                    </p>
                  </div>
                )}
                <p className="text-[7px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                  Notes: {question.scale.intervals.map(i => pitchClassName((question.rootPc + i) % 12)).join(' - ')}
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

      {question && (
        <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
          {options.map(scale => {
            let className = 'option-btn';
            if (answered) {
              if (scale.name === question.scale.name) className += ' correct';
              else if (scale.name === selectedAnswer) className += ' incorrect';
            }
            return (
              <button
                key={scale.name}
                onClick={() => handleAnswer(scale.name)}
                className={className}
                disabled={answered}
              >
                <div className="text-[10px]">{scale.name}</div>
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
            startMidi={question.rootMidi - 1}
            endMidi={question.rootMidi + 14}
            activeNotes={question.scale.intervals.map(i => question.rootMidi + i)}
            activeMode="midi"
          />
        </div>
      )}
    </div>
  );
}
