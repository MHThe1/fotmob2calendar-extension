// background/background.js
import { 
  getSettings, 
  getSyncedMatches, 
  recordSyncedMatch, 
  removeSyncedMatch, 
  getAuthState 
} from '../utils/storage.js';
import { 
  getValidAuthToken, 
  disconnectGoogle, 
  getCalendars, 
  createCalendarEvent, 
  deleteCalendarEvent, 
  findEventByFotmobId,
  buildWebCalendarUrl
} from '../utils/gcal.js';

// Handle messages from content script, popup, or options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  handleMessage(type, payload, sender)
    .then((response) => sendResponse({ success: true, data: response }))
    .catch((error) => {
      console.error(`Error handling ${type}:`, error);
      sendResponse({ success: false, error: error.message || String(error) });
    });

  // Return true to indicate asynchronous response
  return true;
});

async function handleMessage(type, payload, sender) {
  switch (type) {
    case 'AUTH_STATUS': {
      const auth = await getAuthState();
      const settings = await getSettings();
      const hasToken = Boolean(auth && auth.token && auth.expiresAt > Date.now());
      return {
        isAuthenticated: hasToken,
        user: auth?.user || null,
        clientIdConfigured: Boolean(settings.clientId && settings.clientId.trim()),
        selectedCalendarId: settings.selectedCalendarId || 'primary'
      };
    }

    case 'AUTH_CONNECT': {
      const token = await getValidAuthToken(true);
      const auth = await getAuthState();
      return { token, user: auth?.user || null };
    }

    case 'AUTH_DISCONNECT': {
      await disconnectGoogle();
      return { disconnected: true };
    }

    case 'GET_CALENDARS': {
      const token = await getValidAuthToken(false);
      return await getCalendars(token);
    }

    case 'CHECK_MATCH': {
      const { matchId } = payload;
      const synced = await getSyncedMatches();
      const record = synced[matchId];
      return {
        isSynced: Boolean(record),
        record: record || null
      };
    }

    case 'CHECK_BATCH_MATCHES': {
      const { matchIds } = payload;
      const synced = await getSyncedMatches();
      const result = {};
      if (Array.isArray(matchIds)) {
        matchIds.forEach((id) => {
          result[id] = Boolean(synced[id]);
        });
      }
      return result;
    }

    case 'ADD_MATCH': {
      const { match } = payload;
      if (!match || !match.id) {
        throw new Error('Invalid match data provided.');
      }

      const settings = await getSettings();
      let token;
      try {
        token = await getValidAuthToken(false);
      } catch (authErr) {
        if (authErr.message === 'MISSING_CLIENT_ID' || authErr.message === 'TOKEN_EXPIRED') {
          // If OAuth is not configured, generate fallback Google Calendar web link
          const fallbackUrl = buildWebCalendarUrl(match, settings);
          return {
            fallbackUrl,
            needsSetup: true,
            message: 'Google Calendar OAuth not connected yet. Click to open Google Calendar directly or configure in extension settings.'
          };
        }
        throw authErr;
      }

      const calendarId = settings.selectedCalendarId || 'primary';
      const event = await createCalendarEvent(token, calendarId, match, settings);

      // Record in local cache
      const recordData = {
        eventId: event.id,
        calendarId,
        matchId: String(match.id),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league: match.league,
        kickoff: match.kickoff,
        htmlLink: event.htmlLink,
        summary: event.summary,
        addedAt: new Date().toISOString()
      };
      await recordSyncedMatch(match.id, recordData);

      return {
        isSynced: true,
        eventId: event.id,
        htmlLink: event.htmlLink,
        record: recordData
      };
    }

    case 'REMOVE_MATCH': {
      const { matchId } = payload;
      if (!matchId) throw new Error('Missing matchId.');

      const settings = await getSettings();
      const synced = await getSyncedMatches();
      const record = synced[matchId];

      const token = await getValidAuthToken(false);
      const calendarId = record?.calendarId || settings.selectedCalendarId || 'primary';
      let eventId = record?.eventId;

      // If not in local storage, search Google Calendar
      if (!eventId) {
        const found = await findEventByFotmobId(token, calendarId, matchId);
        if (found) eventId = found.id;
      }

      if (eventId) {
        await deleteCalendarEvent(token, calendarId, eventId);
      }

      await removeSyncedMatch(matchId);
      return { removed: true, matchId };
    }

    case 'FETCH_FOTMOB_DETAILS': {
      const { matchId } = payload;
      if (!matchId) throw new Error('Missing matchId.');
      try {
        const res = await fetch(`https://www.fotmob.com/api/matchDetails?matchId=${encodeURIComponent(matchId)}`);
        if (res.ok) {
          const json = await res.json();
          return json;
        }
      } catch (e) {
        console.warn('Background fetch for FotMob details failed:', e);
      }
      return null;
    }

    case 'OPEN_OPTIONS': {
      chrome.runtime.openOptionsPage();
      return { opened: true };
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}
