// Chord definitions and detection

import { pitchClassName } from './theory';

export interface ChordDef {
  name: string;
  shortName: string;
  intervals: number[]; // Semitones from root
  difficulty: 1 | 2 | 3;
  color: string;
}

export const CHORD_TYPES: ChordDef[] = [
  { name: 'Major', shortName: 'maj', intervals: [0, 4, 7], difficulty: 1, color: '#ffd93d' },
  { name: 'Minor', shortName: 'min', intervals: [0, 3, 7], difficulty: 1, color: '#23d5ab' },
  { name: 'Diminished', shortName: 'dim', intervals: [0, 3, 6], difficulty: 2, color: '#c56cf0' },
  { name: 'Augmented', shortName: 'aug', intervals: [0, 4, 8], difficulty: 2, color: '#ff6e6c' },
  { name: 'Suspended 2nd', shortName: 'sus2', intervals: [0, 2, 7], difficulty: 2, color: '#4ecdc4' },
  { name: 'Suspended 4th', shortName: 'sus4', intervals: [0, 5, 7], difficulty: 2, color: '#6bcb77' },
  { name: 'Major 7th', shortName: 'maj7', intervals: [0, 4, 7, 11], difficulty: 2, color: '#ff8e72' },
  { name: 'Minor 7th', shortName: 'min7', intervals: [0, 3, 7, 10], difficulty: 2, color: '#23d5ab' },
  { name: 'Dominant 7th', shortName: '7', intervals: [0, 4, 7, 10], difficulty: 2, color: '#ffd93d' },
  { name: 'Diminished 7th', shortName: 'dim7', intervals: [0, 3, 6, 9], difficulty: 3, color: '#c56cf0' },
  { name: 'Half-Diminished 7th', shortName: 'm7b5', intervals: [0, 3, 6, 10], difficulty: 3, color: '#ff6e6c' },
  { name: 'Minor Major 7th', shortName: 'mM7', intervals: [0, 3, 7, 11], difficulty: 3, color: '#4ecdc4' },
  { name: 'Augmented 7th', shortName: 'aug7', intervals: [0, 4, 8, 10], difficulty: 3, color: '#6bcb77' },
  { name: 'Major 9th', shortName: 'maj9', intervals: [0, 4, 7, 11, 14], difficulty: 3, color: '#ff8e72' },
  { name: 'Minor 9th', shortName: 'min9', intervals: [0, 3, 7, 10, 14], difficulty: 3, color: '#23d5ab' },
  { name: 'Dominant 9th', shortName: '9', intervals: [0, 4, 7, 10, 14], difficulty: 3, color: '#ffd93d' },
];

export interface DetectedChord {
  root: number; // Pitch class 0-11
  type: ChordDef;
  confidence: number; // 0-1
  notes: number[]; // Pitch classes present
}

// Build a chromagram template for a chord type at a given root
function buildTemplate(root: number, chord: ChordDef): number[] {
  const template = new Array(12).fill(0);
  for (const interval of chord.intervals) {
    template[(root + interval) % 12] = 1;
  }
  return template;
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Detect chord from a chromagram (12-element array of pitch class energies)
export function detectChordFromChroma(
  chroma: number[],
  maxDifficulty: 1 | 2 | 3 = 3
): DetectedChord | null {
  const types = CHORD_TYPES.filter(c => c.difficulty <= maxDifficulty);
  let best: DetectedChord | null = null;
  let bestScore = 0.75; // Higher threshold to avoid false positives

  for (let root = 0; root < 12; root++) {
    for (const type of types) {
      const template = buildTemplate(root, type);
      const score = cosineSimilarity(chroma, template);
      if (score > bestScore) {
        bestScore = score;
        best = {
          root,
          type,
          confidence: score,
          notes: type.intervals.map(i => (root + i) % 12),
        };
      }
    }
  }

  return best;
}

// Detect chord from a set of MIDI note numbers (from ML detection)
// This is much more accurate than chromagram matching because
// the ML model already filtered out harmonics
export function detectChordFromMidis(midis: number[]): DetectedChord | null {
  if (midis.length < 2) return null;

  // Get unique pitch classes, sorted lowest to highest
  const pcs = [...new Set(midis.map(m => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pcs.length < 2) return null;

  let best: DetectedChord | null = null;
  let bestScore = 0;

  // Try each pitch class as potential root
  for (const root of pcs) {
    // Calculate intervals from this root
    const intervals = pcs.map(pc => ((pc - root) % 12 + 12) % 12).sort((a, b) => a - b);

    // Match against chord types
    for (const type of CHORD_TYPES) {
      // Reduce chord intervals to within one octave for comparison
      const typeIntervals = type.intervals.map(i => i % 12);

      // Count how many chord tones are present
      let matched = 0;
      for (const ti of typeIntervals) {
        if (intervals.includes(ti)) matched++;
      }

      // Score: proportion of chord tones found, penalize extra notes
      const coverage = matched / typeIntervals.length;
      const extraNotes = intervals.length - matched;
      const score = coverage - extraNotes * 0.15;

      // Must have at least the root and one other chord tone
      if (matched >= 2 && score > bestScore) {
        bestScore = score;
        best = {
          root,
          type,
          confidence: score,
          notes: typeIntervals.map(i => (root + i) % 12),
        };
      }
    }
  }

  return best;
}

// Format a detected chord as a string (e.g., "C maj", "F# min7")
export function formatChord(chord: DetectedChord): string {
  return `${pitchClassName(chord.root)} ${chord.type.shortName}`;
}

// Format chord with full name
export function formatChordFull(chord: DetectedChord): string {
  return `${pitchClassName(chord.root)} ${chord.type.name}`;
}

export function getChordsByDifficulty(maxDifficulty: 1 | 2 | 3): ChordDef[] {
  return CHORD_TYPES.filter(c => c.difficulty <= maxDifficulty);
}
