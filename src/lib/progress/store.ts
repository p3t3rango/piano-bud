// Progress tracking with localStorage persistence

export interface ExerciseRecord {
  type: 'interval' | 'chord' | 'scale' | 'progression';
  correct: boolean;
  item: string; // What was being tested (e.g., "Major 3rd", "C min")
  timestamp: number;
}

export interface DayStats {
  date: string; // YYYY-MM-DD
  totalExercises: number;
  correct: number;
  xpEarned: number;
}

export interface ProgressData {
  xp: number;
  level: number;
  streak: number; // Consecutive days
  lastActiveDate: string; // YYYY-MM-DD
  totalExercises: number;
  totalCorrect: number;
  history: ExerciseRecord[];
  dailyStats: DayStats[];
  // Per-exercise-type accuracy
  intervalAccuracy: Record<string, { correct: number; total: number }>;
  chordAccuracy: Record<string, { correct: number; total: number }>;
  scaleAccuracy: Record<string, { correct: number; total: number }>;
  progressionAccuracy: Record<string, { correct: number; total: number }>;
}

const STORAGE_KEY = 'piano-bud-progress';

// XP per correct answer
const XP_CORRECT = 10;
const XP_BONUS_STREAK = 5;
// XP needed per level (increases each level)
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function defaultProgress(): ProgressData {
  return {
    xp: 0,
    level: 1,
    streak: 0,
    lastActiveDate: '',
    totalExercises: 0,
    totalCorrect: 0,
    history: [],
    dailyStats: [],
    intervalAccuracy: {},
    chordAccuracy: {},
    scaleAccuracy: {},
    progressionAccuracy: {},
  };
}

export function loadProgress(): ProgressData {
  if (typeof window === 'undefined') return defaultProgress();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProgress();
    return JSON.parse(raw);
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(data: ProgressData): void {
  if (typeof window === 'undefined') return;
  // Keep history manageable (last 1000 entries)
  if (data.history.length > 1000) {
    data.history = data.history.slice(-1000);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordExercise(
  type: ExerciseRecord['type'],
  item: string,
  correct: boolean
): { xpGained: number; leveledUp: boolean; newLevel: number; data: ProgressData } {
  const data = loadProgress();
  const today = todayStr();

  // Update streak
  if (data.lastActiveDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (data.lastActiveDate === yesterdayStr) {
      data.streak += 1;
    } else if (data.lastActiveDate !== today) {
      data.streak = 1;
    }
    data.lastActiveDate = today;
  }

  // Record exercise
  const record: ExerciseRecord = { type, correct, item, timestamp: Date.now() };
  data.history.push(record);
  data.totalExercises += 1;
  if (correct) data.totalCorrect += 1;

  // Update per-type accuracy
  const accMap = {
    interval: data.intervalAccuracy,
    chord: data.chordAccuracy,
    scale: data.scaleAccuracy,
    progression: data.progressionAccuracy,
  }[type];
  if (!accMap[item]) accMap[item] = { correct: 0, total: 0 };
  accMap[item].total += 1;
  if (correct) accMap[item].correct += 1;

  // Update daily stats
  let dayStats = data.dailyStats.find(d => d.date === today);
  if (!dayStats) {
    dayStats = { date: today, totalExercises: 0, correct: 0, xpEarned: 0 };
    data.dailyStats.push(dayStats);
  }
  dayStats.totalExercises += 1;
  if (correct) dayStats.correct += 1;

  // Calculate XP
  let xpGained = 0;
  if (correct) {
    xpGained = XP_CORRECT + (data.streak > 1 ? XP_BONUS_STREAK : 0);
  }
  data.xp += xpGained;
  dayStats.xpEarned += xpGained;

  // Check level up
  let leveledUp = false;
  const oldLevel = data.level;
  while (data.xp >= xpForLevel(data.level)) {
    data.xp -= xpForLevel(data.level);
    data.level += 1;
    leveledUp = true;
  }

  saveProgress(data);

  return { xpGained, leveledUp, newLevel: data.level, data };
}

export function getAccuracy(type: ExerciseRecord['type']): number {
  const data = loadProgress();
  const recent = data.history.filter(h => h.type === type).slice(-50);
  if (recent.length === 0) return 0;
  return recent.filter(h => h.correct).length / recent.length;
}

export function getTodayStats(): DayStats | null {
  const data = loadProgress();
  return data.dailyStats.find(d => d.date === todayStr()) ?? null;
}

export function resetProgress(): void {
  saveProgress(defaultProgress());
}
