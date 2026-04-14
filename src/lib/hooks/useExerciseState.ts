'use client';

import { useCallback, useState } from 'react';
import { playSfx, type Instrument } from '@/lib/audio/synth';
import { recordExercise } from '@/lib/progress/store';

type ExerciseCategory = 'interval' | 'chord' | 'scale' | 'progression';

interface Feedback {
  xp: number;
  levelUp: boolean;
}

interface Score {
  correct: number;
  total: number;
}

export interface ExerciseState<A> {
  answered: boolean;
  selectedAnswer: A | null;
  score: Score;
  feedback: Feedback | null;
  instrument: Instrument;
  setInstrument: (i: Instrument) => void;
  submitAnswer: (answer: A, correct: boolean, itemName: string) => void;
  resetForNext: () => void;
  restart: () => void;
}

export function useExerciseState<A>(
  category: ExerciseCategory,
  defaultInstrument: Instrument = 'piano',
): ExerciseState<A> {
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<A | null>(null);
  const [score, setScore] = useState<Score>({ correct: 0, total: 0 });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [instrument, setInstrument] = useState<Instrument>(defaultInstrument);

  const submitAnswer = useCallback(
    (answer: A, correct: boolean, itemName: string) => {
      setAnswered(true);
      setSelectedAnswer(answer);
      playSfx(correct ? 'correct' : 'incorrect');
      const result = recordExercise(category, itemName, correct);
      setFeedback({ xp: result.xpGained, levelUp: result.leveledUp });
      setScore(prev => ({
        correct: prev.correct + (correct ? 1 : 0),
        total: prev.total + 1,
      }));
    },
    [category],
  );

  const resetForNext = useCallback(() => {
    setAnswered(false);
    setSelectedAnswer(null);
    setFeedback(null);
  }, []);

  const restart = useCallback(() => {
    setScore({ correct: 0, total: 0 });
    setAnswered(false);
    setSelectedAnswer(null);
    setFeedback(null);
  }, []);

  return {
    answered,
    selectedAnswer,
    score,
    feedback,
    instrument,
    setInstrument,
    submitAnswer,
    resetForNext,
    restart,
  };
}
