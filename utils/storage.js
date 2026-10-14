// utils/storage.js

export const DEFAULT_SETTINGS = {
  clientId: '',
  selectedCalendarId: 'primary',
  selectedCalendarName: 'Primary Calendar',
  durationMinutes: 115,
  eventColorId: '10', // Basil (Google Calendar Green)
  titleFormat: '⚽ {home} vs {away} ({league})',
  includeVenue: true,
  includeFotmobUrl: true,
  includeRoundInfo: true,
  reminders: [
    { method: 'popup', minutes: 15 },
    { method: 'popup', minutes: 60 }
  ]
};

export const GCAL_COLORS = [
  { id: '1', name: 'Lavender', hex: '#7986cb' },
  { id: '2', name: 'Sage', hex: '#33b679' },
  { id: '3', name: 'Grape', hex: '#8e24aa' },
  { id: '4', name: 'Flamingo', hex: '#e67c73' },
  { id: '5', name: 'Banana', hex: '#f6bf26' },
  { id: '6', name: 'Tangerine', hex: '#f4511e' },
  { id: '7', name: 'Peacock', hex: '#039be5' },
  { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Blueberry', hex: '#3f51b5' },
  { id: '10', name: 'Basil', hex: '#0b8043' },
  { id: '11', name: 'Tomato', hex: '#d50000' }
];

/**
 * Retrieve user configuration settings merged with defaults.
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['fotmob_settings'], (result) => {
      if (chrome.runtime.lastError || !result.fotmob_settings) {
        resolve({ ...DEFAULT_SETTINGS });
      } else {
        resolve({ ...DEFAULT_SETTINGS, ...result.fotmob_settings });
      }
    });
  });
}

/**
 * Save user configuration settings.
 */
export async function saveSettings(settings) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ fotmob_settings: settings }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(settings);
      }
    });
  });
}

/**
 * Retrieve the map of all synced matches: { [matchId]: { eventId, calendarId, ... } }
 */
export async function getSyncedMatches() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fotmob_synced_matches'], (result) => {
      if (chrome.runtime.lastError || !result.fotmob_synced_matches) {
        resolve({});
      } else {
        resolve(result.fotmob_synced_matches);
      }
    });
  });
}

/**
 * Record a synced match in local storage.
 */
export async function recordSyncedMatch(matchId, matchData) {
  const all = await getSyncedMatches();
  all[matchId] = {
    ...matchData,
    updatedAt: new Date().toISOString()
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ fotmob_synced_matches: all }, () => resolve(all));
  });
}

/**
 * Remove a match record from local storage.
 */
export async function removeSyncedMatch(matchId) {
  const all = await getSyncedMatches();
  delete all[matchId];
  return new Promise((resolve) => {
    chrome.storage.local.set({ fotmob_synced_matches: all }, () => resolve(all));
  });
}

/**
 * Get cached auth state (token, user info).
 */
export async function getAuthState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fotmob_auth_state'], (result) => {
      resolve(result.fotmob_auth_state || null);
    });
  });
}

/**
 * Save cached auth state.
 */
export async function saveAuthState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ fotmob_auth_state: state }, () => resolve(state));
  });
}

/**
 * Clear cached auth state.
 */
export async function clearAuthState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['fotmob_auth_state'], () => resolve());
  });
}
