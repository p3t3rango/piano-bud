'use client';

import { useState, useCallback } from 'react';
import { INTERVALS, getIntervalsByDifficulty, type IntervalDef } from '@/lib/music/intervals';
import { playInterval, playSfx, unlockAudio, INSTRUMENTS, type Instrument } from '@/lib/audio/synth';
import { recordExercise } from '@/lib/progress/store';
import { midiToNoteName } from '@/lib/music/theory';
import PianoKeyboard from '@/components/PianoKeyboard';

type Difficulty = 1 | 2 | 3;
type PlayMode = 'melodic' | 'harmonic';

interface Question {
  rootMidi: number;
  interval: IntervalDef;
  mode: PlayMode;
}

function generateQuestion(difficulty: Difficulty, mode: PlayMode): Question {
  const intervals = getIntervalsByDifficulty(difficulty).filter(i => i.semitones > 0);
  const interval = intervals[Math.floor(Math.random() * intervals.length)];
  // Random root between C3 and C5
  const rootMidi = 48 + Math.floor(Math.random() * 24);
  return { rootMidi, interval, mode };
}

export default function IntervalTrainerPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [playMode, setPlayMode] = useState<PlayMode>('melodic');
  const [question, setQuestion] = useState<Question | null>(null);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [feedback, setFeedback] = useState<{ xp: number; levelUp: boolean } | null>(null);
  const [instrument, setInstrument] = useState<Instrument>('retro');

  const options = getIntervalsByDifficulty(difficulty).filter(i => i.semitones > 0);

  const newQuestion = useCallback(() => {
    unlockAudio();
    const q = generateQuestion(difficulty, playMode);
    setQuestion(q);
    setAnswered(false);
    setSelectedAnswer(null);
    setFeedback(null);
    playInterval(q.rootMidi, q.interval.semitones, q.mode, instrument);
  }, [difficulty, playMode, instrument]);

  const restart = () => {
    setScore({ correct: 0, total: 0 });
    setQuestion(null);
    setAnswered(false);
    setSelectedAnswer(null);
    setFeedback(null);
  };

  const handleAnswer = (semitones: number) => {
    if (answered || !question) return;
    setAnswered(true);
    setSelectedAnswer(semitones);

    const correct = semitones === question.interval.semitones;
    playSfx(correct ? 'correct' : 'incorrect');

    const result = recordExercise('interval', question.interval.name, correct);
    setFeedback({ xp: result.xpGained, levelUp: result.leveledUp });
    setScore(prev => ({
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    }));
  };

  const replayQuestion = () => {
    if (!question) return;
    playInterval(question.rootMidi, question.interval.semitones, question.mode, instrument);
  };

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-4 gap-4">
      <h2 className="text-sm text-pink" style={{ fontFamily: 'var(--font-pixel)' }}>
        INTERVALS
      </h2>

      {/* Settings bar */}
      <div className="flex gap-2 flex-wrap justify-center">
        {([1, 2, 3] as Difficulty[]).map(d => (
          <button
            key={d}
            onClick={() => { setDifficulty(d); setQuestion(null); }}
            className={`badge ${d === 1 ? 'badge-easy' : d === 2 ? 'badge-medium' : 'badge-hard'} ${difficulty === d ? 'ring-1 ring-current' : 'opacity-50'}`}
          >
            {d === 1 ? 'Easy' : d === 2 ? 'Medium' : 'Hard'}
          </button>
        ))}
        <span className="text-[7px] text-cream-dim mx-1 self-center" style={{ fontFamily: 'var(--font-pixel)' }}>|</span>
        {(['melodic', 'harmonic'] as PlayMode[]).map(m => (
          <button
            key={m}
            onClick={() => { setPlayMode(m); setQuestion(null); }}
            className={`badge ${playMode === m ? 'badge-easy ring-1 ring-current' : 'badge-easy opacity-50'}`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Instrument & restart */}
      <div className="flex gap-2 flex-wrap justify-center items-center">
        {INSTRUMENTS.map(inst => (
          <button
            key={inst.id}
            onClick={() => setInstrument(inst.id)}
            className={`badge ${instrument === inst.id ? 'badge-medium ring-1 ring-current' : 'badge-medium opacity-50'}`}
          >
            {inst.label}
          </button>
        ))}
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
      <div className="crt-screen w-full max-w-lg p-6 flex flex-col items-center gap-4 min-h-[160px]">
        {!question ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-[9px] text-cream-dim text-center" style={{ fontFamily: 'var(--font-pixel)' }}>
              Listen and identify the interval
            </p>
            <button onClick={newQuestion} className="retro-btn retro-btn-pink retro-btn-big">
              Start
            </button>
          </div>
        ) : (
          <>
            <button onClick={replayQuestion} className="retro-btn retro-btn-amber text-[8px]">
              ♫ Replay
            </button>

            {answered && (
              <div className="text-center">
                {selectedAnswer === question.interval.semitones ? (
                  <p className="text-sm text-green glow-text" style={{ fontFamily: 'var(--font-pixel)' }}>CORRECT!</p>
                ) : (
                  <div>
                    <p className="text-sm text-pink" style={{ fontFamily: 'var(--font-pixel)' }}>
                      NOPE!
                    </p>
                    <p className="text-[8px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                      It was: <span className="text-amber">{question.interval.name}</span>
                    </p>
                  </div>
                )}
                <p className="text-[7px] text-cream-dim mt-1" style={{ fontFamily: 'var(--font-pixel)' }}>
                  {midiToNoteName(question.rootMidi)} → {midiToNoteName(question.rootMidi + question.interval.semitones)}
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
          {options.map(interval => {
            let className = 'option-btn';
            if (answered) {
              if (interval.semitones === question.interval.semitones) {
                className += ' correct';
              } else if (interval.semitones === selectedAnswer) {
                className += ' incorrect';
              }
            }
            return (
              <button
                key={interval.semitones}
                onClick={() => handleAnswer(interval.semitones)}
                className={className}
                disabled={answered}
              >
                <div>
                  <div className="text-[10px]">{interval.name}</div>
                  <div className="text-[7px] opacity-60 mt-1">{interval.shortName}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Next button */}
      {answered && (
        <button onClick={newQuestion} className="retro-btn retro-btn-teal retro-btn-big">
          Next →
        </button>
      )}

      {/* Keyboard showing the interval */}
      {question && answered && (
        <div className="w-full max-w-lg mt-2">
          <PianoKeyboard
            startMidi={question.rootMidi - 2}
            endMidi={question.rootMidi + question.interval.semitones + 2}
            activeNotes={[question.rootMidi, question.rootMidi + question.interval.semitones]}
            activeMode="midi"
          />
        </div>
      )}
    </div>
  );
}
