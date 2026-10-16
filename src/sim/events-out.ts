// Events emitted by commands, for the presentation layer. Text is referenced by the
// original field/cast name (e.g. "NoBuild", "T623", "NoM2"); see src/content for strings.
import type { LogEntry, Prompt } from './state.ts';

export type DisasterKind = 'fire' | 'tornado' | 'grasshoppers' | 'cattle' | 'animalsDied';

export type SimEvent =
  | { type: 'dialog'; id: string; dbox?: string; params?: Record<string, string | number> }
  | { type: 'prompt'; prompt: Prompt }
  | { type: 'cash'; delta: number; requested: number; cash: number; reason: string }
  | { type: 'savings'; delta: number; savings: number; reason: string }
  /** `reason`: event/text id (e.g. `DL1`, `Wed1`) or a key such as `business2`, `claim`. */
  | { type: 'score'; delta: number; score: number; reason: string }
  | { type: 'lifePrice'; delta: number; lifePrice: number; reason: string }
  | { type: 'dateChanged'; year: number; mon: number; day: number; reason: string }
  | { type: 'monthAdvanced'; year: number; mon: number; day: number }
  | { type: 'scene'; mainView: number }
  | { type: 'disaster'; kind: DisasterKind; squares?: number }
  | { type: 'calendarStarted' }
  | { type: 'calendarStopped'; reason: string }
  /** `startCalendar {yieldEachMonth}` paused after a month advance; send continueCalendar/stopCalendar. */
  | { type: 'calendarRunning'; year: number; mon: number; day: number }
  | { type: 'mail' }
  | { type: 'letter'; id: string; had?: string; sig?: string }
  | { type: 'townTalkAvailable'; index: number; id: number; path: string }
  | { type: 'townTalk'; id: number; path: string }
  | { type: 'trivia'; question: number }
  | { type: 'triviaAnswered'; question: number; correct: boolean; bonus: number }
  | { type: 'harvest'; bushels: number[]; prices: number[]; value: number; index: number }
  | { type: 'built'; item: string }
  | { type: 'goalReached'; text: string; answers: number[] }
  | { type: 'gameOver'; reason: string }
  | { type: 'log'; entry: LogEntry }
  | { type: 'telegram'; net: number }
  | { type: 'rejected'; reason: string; dialog?: string };
