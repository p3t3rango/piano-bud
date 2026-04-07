// Core music theory definitions and utilities

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type NoteName = typeof NOTE_NAMES[number];
export type NoteNameFlat = typeof NOTE_NAMES_FLAT[number];

// A4 = 440Hz, MIDI note 69
export const A4_FREQ = 440;
export const A4_MIDI = 69;

// Some keyboards label middle C (MIDI 60) as C3 instead of C4.
// Apply this offset to the displayed octave number to match the user's keyboard.
export const OCTAVE_DISPLAY_OFFSET = -1;

// Convert MIDI note number to frequency
export function midiToFreq(midi: number): number {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

// Convert frequency to MIDI note number (continuous)
export function freqToMidi(freq: number): number {
  return A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
}

// Convert frequency to nearest MIDI note
export function freqToNearestMidi(freq: number): number {
  return Math.round(freqToMidi(freq));
}

// Convert MIDI note to note name + octave
export function midiToNoteName(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1 + OCTAVE_DISPLAY_OFFSET;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

// Convert MIDI to just the pitch class (0-11)
export function midiToPitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// Convert pitch class to note name
export function pitchClassName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

// Get frequency for a note name + octave (e.g., "C4", "A#3")
export function noteToFreq(note: string): number {
  const match = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const [, name, octStr] = match;
  const octave = parseInt(octStr);
  let noteIndex = NOTE_NAMES.indexOf(name as NoteName);
  if (noteIndex === -1) {
    noteIndex = NOTE_NAMES_FLAT.indexOf(name as NoteNameFlat);
  }
  if (noteIndex === -1) throw new Error(`Invalid note name: ${name}`);
  const midi = (octave + 1) * 12 + noteIndex;
  return midiToFreq(midi);
}

// Get MIDI note number for a note name + octave
export function noteToMidi(note: string): number {
  const match = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const [, name, octStr] = match;
  const octave = parseInt(octStr);
  let noteIndex = NOTE_NAMES.indexOf(name as NoteName);
  if (noteIndex === -1) {
    noteIndex = NOTE_NAMES_FLAT.indexOf(name as NoteNameFlat);
  }
  if (noteIndex === -1) throw new Error(`Invalid note name: ${name}`);
  return (octave + 1) * 12 + noteIndex;
}

// How many cents off from the nearest note
export function freqToCentsOff(freq: number): number {
  const midi = freqToMidi(freq);
  const nearestMidi = Math.round(midi);
  return (midi - nearestMidi) * 100;
}

// Get all note names for a given pitch class (sharp and flat versions)
export function enharmonicNames(pc: number): string[] {
  const sharp = NOTE_NAMES[pc];
  const flat = NOTE_NAMES_FLAT[pc];
  return sharp === flat ? [sharp] : [sharp, flat];
}

// Semitone distance between two pitch classes (always positive, ascending)
export function semitoneDistance(pc1: number, pc2: number): number {
  return ((pc2 - pc1) % 12 + 12) % 12;
}

// Piano key range (A0 = 21 to C8 = 108)
export const PIANO_MIN_MIDI = 21;
export const PIANO_MAX_MIDI = 108;
export const PIANO_KEYS = Array.from(
  { length: PIANO_MAX_MIDI - PIANO_MIN_MIDI + 1 },
  (_, i) => PIANO_MIN_MIDI + i
);

// Is this MIDI note a black key?
export function isBlackKey(midi: number): boolean {
  const pc = midiToPitchClass(midi);
  return [1, 3, 6, 8, 10].includes(pc);
}
