'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadProgress, getTodayStats } from '@/lib/progress/store';

export default function Home() {
  const [stats, setStats] = useState({ level: 1, streak: 0, todayExercises: 0 });

  useEffect(() => {
    const data = loadProgress();
    const today = getTodayStats();
    setStats({
      level: data.level,
      streak: data.streak,
      todayExercises: today?.totalExercises ?? 0,
    });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 gap-8">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl text-amber glow-text mb-3" style={{ fontFamily: 'var(--font-pixel)' }}>
          PIANO
        </h1>
        <h1 className="text-3xl text-pink glow-text mb-4" style={{ fontFamily: 'var(--font-pixel)' }}>
          BUD
        </h1>
        <p className="text-[8px] text-cream-dim animate-pulse-glow" style={{ fontFamily: 'var(--font-pixel)' }}>
          ♪ PRESS START ♪
        </p>
      </div>

      {/* Menu Buttons */}
      <div className="flex flex-col gap-4 w-full max-w-sm">
        <Link href="/listen">
          <button className="retro-btn retro-btn-pink retro-btn-big w-full">
            ♫ Listen Mode
          </button>
        </Link>

        <Link href="/train">
          <button className="retro-btn retro-btn-amber retro-btn-big w-full">
            ★ Ear Training
          </button>
        </Link>

        <Link href="/metronome">
          <button className="retro-btn retro-btn-teal retro-btn-big w-full">
            ◆ Metronome
          </button>
        </Link>

        <Link href="/progress">
          <button className="retro-btn retro-btn-purple retro-btn-big w-full">
            ▲ Progress
          </button>
        </Link>
      </div>

      {/* Quick Stats */}
      {stats.todayExercises > 0 && (
        <div className="crt-screen p-4 w-full max-w-sm text-center">
          <p className="text-[8px] text-cream-dim mb-2" style={{ fontFamily: 'var(--font-pixel)' }}>TODAY</p>
          <p className="text-[10px] text-teal" style={{ fontFamily: 'var(--font-pixel)' }}>
            {stats.todayExercises} exercises completed
          </p>
        </div>
      )}

      {/* Decorative pixel art piano */}
      <div className="flex gap-[2px] mt-4 opacity-30">
        {Array.from({ length: 14 }).map((_, i) => {
          const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
          return (
            <div
              key={i}
              className={isBlack ? 'bg-key-black' : 'bg-key-white'}
              style={{
                width: isBlack ? 8 : 12,
                height: isBlack ? 20 : 32,
                borderRadius: '0 0 2px 2px',
                marginTop: isBlack ? 0 : 12,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
