// Progress tracking with localStorage persistence

export type ExerciseType = 'interval' | 'chord' | 'scale' | 'progression';

export interface ExerciseRecord {
  type: ExerciseType;
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

// Per-item stats used for weighted selection (spaced-repetition lite)
// `lastSeen` and `streak` are optional so existing stored data still parses.
export interface ItemStats {
  correct: number;
  total: number;
  lastSeen?: number;  // ms epoch
  streak?: number;    // consecutive correct answers
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
  intervalAccuracy: Record<string, ItemStats>;
  chordAccuracy: Record<string, ItemStats>;
  scaleAccuracy: Record<string, ItemStats>;
  progressionAccuracy: Record<string, ItemStats>;
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

function sanitizeStatsRecord(v: unknown): Record<string, ItemStats> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, ItemStats> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const correct = typeof s.correct === 'number' ? s.correct : 0;
    const total = typeof s.total === 'number' ? s.total : 0;
    if (total <= 0) continue;
    out[key] = {
      correct,
      total,
      lastSeen: typeof s.lastSeen === 'number' ? s.lastSeen : undefined,
      streak: typeof s.streak === 'number' ? s.streak : undefined,
    };
  }
  return out;
}

// Merge stored data with defaults so missing/newer fields don't crash the
// app and corrupt individual fields get reset without nuking the whole
// progress record.
function mergeWithDefaults(raw: unknown): ProgressData {
  const d = defaultProgress();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  if (typeof r.xp === 'number') d.xp = r.xp;
  if (typeof r.level === 'number') d.level = r.level;
  if (typeof r.streak === 'number') d.streak = r.streak;
  if (typeof r.lastActiveDate === 'string') d.lastActiveDate = r.lastActiveDate;
  if (typeof r.totalExercises === 'number') d.totalExercises = r.totalExercises;
  if (typeof r.totalCorrect === 'number') d.totalCorrect = r.totalCorrect;
  if (Array.isArray(r.history)) d.history = r.history.filter(h => h && typeof h === 'object') as ExerciseRecord[];
  if (Array.isArray(r.dailyStats)) d.dailyStats = r.dailyStats.filter(s => s && typeof s === 'object') as DayStats[];
  d.intervalAccuracy = sanitizeStatsRecord(r.intervalAccuracy);
  d.chordAccuracy = sanitizeStatsRecord(r.chordAccuracy);
  d.scaleAccuracy = sanitizeStatsRecord(r.scaleAccuracy);
  d.progressionAccuracy = sanitizeStatsRecord(r.progressionAccuracy);
  return d;
}

export function loadProgress(): ProgressData {
  if (typeof window === 'undefined') return defaultProgress();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProgress();
    return mergeWithDefaults(JSON.parse(raw));
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
  if (correct) {
    accMap[item].correct += 1;
    accMap[item].streak = (accMap[item].streak ?? 0) + 1;
  } else {
    accMap[item].streak = 0;
  }
  accMap[item].lastSeen = Date.now();

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

// ── Spaced-repetition-lite: weighted item selection ──

function statsMapFor(data: ProgressData, type: ExerciseType): Record<string, ItemStats> {
  return {
    interval: data.intervalAccuracy,
    chord: data.chordAccuracy,
    scale: data.scaleAccuracy,
    progression: data.progressionAccuracy,
  }[type];
}

/**
 * Compute a selection weight for an item. Higher weight = more likely to be
 * picked. Unseen items get a strong boost so they're prioritized. Weak items
 * (low accuracy) get a boost. Stale items (not seen in a while) get a mild
 * boost. Recently-answered-correct items get damped.
 */
function weightForItem(stats: ItemStats | undefined): number {
  if (!stats || stats.total === 0) return 3.0; // New items: strong priority
  const accuracy = stats.correct / stats.total;
  const hoursSinceSeen = stats.lastSeen ? (Date.now() - stats.lastSeen) / 3_600_000 : 1000;
  const streak = stats.streak ?? 0;

  // Base weight inversely related to accuracy (1.0 when perfect, 2.5 when 0%)
  let w = 1 + (1 - accuracy) * 1.5;
  // Staleness boost: +0.5 after 24h, capped
  w += Math.min(0.5, hoursSinceSeen / 48);
  // Damping for recent streaks of correct answers
  if (streak >= 3) w *= 0.6;
  if (streak >= 6) w *= 0.6;
  return Math.max(0.1, w);
}

/**
 * Weighted-random pick from a list. `getKey` maps each item to its stats key.
 * Falls back to uniform random if all weights are zero.
 */
export function pickWeightedItem<T>(
  type: ExerciseType,
  items: T[],
  getKey: (item: T) => string,
): T {
  if (items.length === 0) throw new Error('pickWeightedItem: empty list');
  const data = loadProgress();
  const map = statsMapFor(data, type);
  const weights = items.map(it => weightForItem(map[getKey(it)]));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Returns items whose accuracy is below `threshold`, sorted weakest-first.
 * Used by "Weak Areas" drill. Items never answered are excluded (no data).
 */
export function getWeakItems(type: ExerciseType, threshold = 0.7): string[] {
  const data = loadProgress();
  const map = statsMapFor(data, type);
  return Object.entries(map)
    .filter(([, s]) => s.total >= 3 && s.correct / s.total < threshold)
    .sort(([, a], [, b]) => a.correct / a.total - b.correct / b.total)
    .map(([key]) => key);
}

export function getItemStats(type: ExerciseType, item: string): ItemStats | undefined {
  return statsMapFor(loadProgress(), type)[item];
}
