'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAccuracy } from '@/lib/progress/store';

const EXERCISES = [
  {
    href: '/train/pitch',
    title: 'Perfect Pitch',
    desc: 'Identify notes with no reference — pure ear',
    color: 'coral',
    icon: '?',
  },
  {
    href: '/train/intervals',
    title: 'Intervals',
    desc: 'Identify the distance between two notes',
    color: 'pink',
    icon: '↕',
  },
  {
    href: '/train/chords',
    title: 'Chords',
    desc: 'Recognize chord qualities by ear',
    color: 'amber',
    icon: '♬',
  },
  {
    href: '/train/scales',
    title: 'Scales',
    desc: 'Identify scales and modes',
    color: 'teal',
    icon: '♪',
  },
  {
    href: '/train/progressions',
    title: 'Progressions',
    desc: 'Recognize common chord progressions',
    color: 'purple',
    icon: '→',
  },
  {
    href: '/train/dictation',
    title: 'Dictation',
    desc: 'Transcribe a melody by tapping the keys',
    color: 'teal',
    icon: '✎',
  },
];

export default function TrainPage() {
  const [accuracies, setAccuracies] = useState<Record<string, number>>({});

  useEffect(() => {
    setAccuracies({
      interval: getAccuracy('interval'),
      chord: getAccuracy('chord'),
      scale: getAccuracy('scale'),
      progression: getAccuracy('progression'),
    });
  }, []);

  const typeMap: Record<string, string> = {
    Intervals: 'interval',
    Chords: 'chord',
    Scales: 'scale',
    Progressions: 'progression',
  };

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-6 gap-6">
      <h2 className="text-sm text-amber" style={{ fontFamily: 'var(--font-pixel)' }}>
        EAR TRAINING
      </h2>

      <p className="text-[8px] text-cream-dim text-center max-w-sm" style={{ fontFamily: 'var(--font-pixel)' }}>
        Select an exercise to sharpen your ears
      </p>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        {EXERCISES.map(ex => {
          const acc = accuracies[typeMap[ex.title]] ?? 0;
          return (
            <Link key={ex.href} href={ex.href}>
              <div className={`retro-btn retro-btn-${ex.color} w-full text-left flex items-center gap-4`}>
                <span className="text-2xl">{ex.icon}</span>
                <div className="flex-1">
                  <p className="text-[10px] mb-1">{ex.title}</p>
                  <p className="text-[7px] opacity-60">{ex.desc}</p>
                  {acc > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="xp-bar-track flex-1 h-2">
                        <div
                          className="xp-bar-fill h-full"
                          style={{ width: `${acc * 100}%` }}
                        />
                      </div>
                      <span className="text-[7px] text-teal">{Math.round(acc * 100)}%</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
