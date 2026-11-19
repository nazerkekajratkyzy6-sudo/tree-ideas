export const TEXT = {
  seminar: 'ИИ на уроках русского языка и литературы: эффективные инструменты и педагогические практики',
  title: 'Дерево педагогических идей',
  question: 'Какую ценную идею вы возьмёте с сегодняшнего семинара?',
  instruction: 'Отсканируйте QR-код, укажите имя и поделитесь идеей',
  motto: 'Каждая идея — начало новых возможностей. Вместе мы растём!',
  success: 'Спасибо! Ваша идея отправлена на Дерево педагогических идей',
} as const;

export const LIMITS = { nameMin: 2, nameMax: 80, ideaMin: 3, ideaMax: 500 } as const;

export type Status = 'pending' | 'approved' | 'rejected';
export type Phase = 'idle' | 'intro' | 'collect' | 'finale';

export interface ResponseDoc {
  id: string;
  name: string;
  idea: string;
  status: Status;
  leafIndex: number;
  seed: number;
  createdAt: number;
  updatedAt: number;
  isTest: boolean;
  schemaVersion: number;
}

export interface SceneState {
  phase: Phase;
  introRun: number;
  finaleRun: number;
  qrVisible: boolean;
  paused: boolean;
  moderation: boolean;
  accepting: boolean;
  testMode: boolean;
  dataEpoch: number;
  skipRun: number;
  phaseStartedAt: number;
  updatedAt: number;
}

export const DEFAULT_STATE: SceneState = {
  phase: 'idle', introRun: 0, finaleRun: 0, qrVisible: true, paused: false,
  moderation: false, accepting: true, testMode: false, dataEpoch: 0, skipRun: 0, phaseStartedAt: 0, updatedAt: 0,
};

export interface FeedLeaf {
  id: string;
  visible: boolean;
  leafIndex: number;
  seed: number;
  name?: string;
  idea?: string;
  createdAt?: number;
}

export interface FeedResponse { serverNow: number; cursor: number; state: SceneState; leaves: FeedLeaf[] }

export interface PublicConfig {
  mode: 'redis' | 'local';
  accepting: boolean;
  publicUrl?: string;
}

export const INTRO_DURATION = 45;

/** Примеры на дереве при открытии экрана. В базу и экспорт не попадают. */
export const SAMPLE_LABEL = 'Пример';
export const SAMPLE_IDEAS = [
  'Попрошу ИИ составлять разноуровневые задания к тексту, а проверку смысла оставлю ученикам.',
  'Буду сравнивать на уроке ответ ИИ с авторским текстом и обсуждать, чего машине не хватает.',
];
