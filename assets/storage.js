const VERSION = "v2";
const PREFIX = `payrollPrep:${VERSION}`;

const keys = {
  settings: `${PREFIX}:settings`,
  attempt: `${PREFIX}:attempt:current`,
  history: `${PREFIX}:attempt:history`,
  weakness: `${PREFIX}:weaknessProfile`,
};

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
};

export const storage = {
  keys,
  loadSettings: () => safeParse(localStorage.getItem(keys.settings), null),
  saveSettings: (settings) => localStorage.setItem(keys.settings, JSON.stringify(settings)),
  loadAttempt: () => safeParse(localStorage.getItem(keys.attempt), null),
  saveAttempt: (attempt) => localStorage.setItem(keys.attempt, JSON.stringify(attempt)),
  clearAttempt: () => localStorage.removeItem(keys.attempt),
  loadHistory: () => safeParse(localStorage.getItem(keys.history), []),
  saveHistory: (history) => localStorage.setItem(keys.history, JSON.stringify(history)),
  loadWeakness: () => safeParse(localStorage.getItem(keys.weakness), null),
  saveWeakness: (profile) => localStorage.setItem(keys.weakness, JSON.stringify(profile)),
  clearAll: () => {
    Object.values(keys).forEach((key) => localStorage.removeItem(key));
  },
  migrateIfNeeded: () => {
    const existing = Object.keys(localStorage).filter((key) => key.startsWith("payrollPrep:"));
    const needsClear = existing.some((key) => !key.startsWith(PREFIX));
    if (needsClear) {
      existing.forEach((key) => localStorage.removeItem(key));
    }
  },
};

export const defaultSettings = {
  mode: "timed",
  enabledPacks: ["core"],
  funMode: false,
  partialCredit: false,
  blueprint: {
    questionCount: {
      timed: 30,
      study: 20,
      drills: 20,
      domain: 20,
      weakness: 20,
    },
    timeLimitMinutes: 60,
    domainWeights: {
      1: 0.2,
      2: 0.35,
      3: 0.2,
      4: 0.15,
      5: 0.1,
    },
    difficultyMix: {
      easy: 0.4,
      medium: 0.4,
      hard: 0.2,
    },
    typeMix: {
      mcq: 0.35,
      msq: 0.15,
      numeric: 0.3,
      fill: 0.05,
      order: 0.05,
      match: 0.05,
      multi_numeric: 0.05,
    },
  },
};
