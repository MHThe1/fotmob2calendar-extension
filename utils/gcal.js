// utils/gcal.js
import { getSettings, saveAuthState, getAuthState, clearAuthState } from './storage.js';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

/**
 * Fetch a valid OAuth access token.
 * Tries cached token first, then launchWebAuthFlow or getAuthToken.
 */
export async function getValidAuthToken(interactive = false) {
  const cachedAuth = await getAuthState();
  if (cachedAuth && cachedAuth.token) {
    // Check if token has expired with 60 second safety buffer
    const now = Date.now();
    if (cachedAuth.expiresAt && cachedAuth.expiresAt > now + 60000) {
      return cachedAuth.token;
    }
  }

  const settings = await getSettings();
  const manifest = chrome.runtime.getManifest();
  const manifestClientId = manifest.oauth2?.client_id;
  const clientId = (settings.clientId && settings.clientId.trim()) || 
                   (manifestClientId && !manifestClientId.includes('PASTE_YOUR') ? manifestClientId : null);

  if (!clientId) {
    throw new Error('MISSING_CLIENT_ID');
  }

  // Use launchWebAuthFlow which supports custom Client IDs and explicit redirect URIs
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId.trim());
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', OAUTH_SCOPES.join(' '));
  authUrl.searchParams.set('prompt', 'select_account');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.toString(),
        interactive: Boolean(interactive)
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!redirectUrl) {
          return reject(new Error('Authentication was cancelled or failed.'));
        }

        try {
          const url = new URL(redirectUrl);
          // Token is in URL fragment: #access_token=...&expires_in=...
          const hashParams = new URLSearchParams(url.hash.substring(1));
          const token = hashParams.get('access_token');
          const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

          if (!token) {
            const errorParam = hashParams.get('error') || url.searchParams.get('error');
            return reject(new Error(errorParam || 'Failed to extract access token from Google response.'));
          }

          // Fetch user profile info
          let userInfo = {};
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (userRes.ok) {
              userInfo = await userRes.json();
            }
          } catch (e) {
            console.warn('Could not fetch user profile details:', e);
          }

          const authState = {
            token,
            expiresAt: Date.now() + expiresIn * 1000,
            user: {
              email: userInfo.email || 'Connected Google Account',
              name: userInfo.name || '',
              picture: userInfo.picture || ''
            }
          };

          await saveAuthState(authState);
          resolve(token);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/**
 * Disconnect Google session and clear cached tokens.
 */
export async function disconnectGoogle() {
  const cachedAuth = await getAuthState();
  if (cachedAuth && cachedAuth.token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${cachedAuth.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch (e) {
      // Ignored if revocation fails
    }
  }
  await clearAuthState();
}

/**
 * Fetch writable calendars for the authenticated user.
 */
export async function getCalendars(token) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    if (res.status === 401) {
      await clearAuthState();
      throw new Error('TOKEN_EXPIRED');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch calendars (${res.status})`);
  }

  const data = await res.json();
  return (data.items || []).map((cal) => ({
    id: cal.id,
    summary: cal.summary,
    primary: Boolean(cal.primary),
    backgroundColor: cal.backgroundColor || '#0284c7',
    accessRole: cal.accessRole
  }));
}

/**
 * Create a football match event on Google Calendar.
 */
export async function createCalendarEvent(token, calendarId, match, settings) {
  const kickoff = new Date(match.kickoff);
  if (isNaN(kickoff.getTime())) {
    throw new Error('Invalid match kickoff timestamp: ' + match.kickoff);
  }

  const durationMin = parseInt(settings.durationMinutes || 115, 10);
  const endTime = new Date(kickoff.getTime() + durationMin * 60000);

  // Format event title based on template
  let title = settings.titleFormat || '⚽ {home} vs {away} ({league})';
  title = title
    .replace('{home}', match.homeTeam || 'Home')
    .replace('{away}', match.awayTeam || 'Away')
    .replace('{league}', match.league || '')
    .replace('{round}', match.round || '')
    .replace(/\s*\(\s*\)/g, '')
    .trim();

  // Construct structured description
  const descLines = [];
  if (match.league) descLines.push(`🏆 Competition: ${match.league}`);
  if (match.round && settings.includeRoundInfo) descLines.push(`📌 Stage/Round: ${match.round}`);
  if (match.venue && settings.includeVenue) descLines.push(`🏟️ Venue: ${match.venue}`);
  if (match.url && settings.includeFotmobUrl) descLines.push(`🔗 FotMob Match: ${match.url}`);
  descLines.push('', '— Added via FotMob to Google Calendar Extension');

  const payload = {
    summary: title,
    description: descLines.join('\n'),
    location: (settings.includeVenue && match.venue) ? match.venue : '',
    start: {
      dateTime: kickoff.toISOString()
    },
    end: {
      dateTime: endTime.toISOString()
    },
    colorId: settings.eventColorId || '10',
    extendedProperties: {
      private: {
        fotmobMatchId: String(match.id),
        source: 'fotmob2calendar'
      }
    }
  };

  // Configure Reminders
  if (Array.isArray(settings.reminders) && settings.reminders.length > 0) {
    payload.reminders = {
      useDefault: false,
      overrides: settings.reminders.map((r) => ({
        method: r.method || 'popup',
        minutes: parseInt(r.minutes, 10) || 15
      }))
    };
  } else {
    payload.reminders = { useDefault: true };
  }

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    if (res.status === 401) {
      await clearAuthState();
      throw new Error('TOKEN_EXPIRED');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to create calendar event (${res.status})`);
  }

  return await res.json();
}

/**
 * Delete an event from Google Calendar.
 */
export async function deleteCalendarEvent(token, calendarId, eventId) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    if (res.status === 401) {
      await clearAuthState();
      throw new Error('TOKEN_EXPIRED');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to remove event (${res.status})`);
  }

  return true;
}

/**
 * Search calendar for an existing event with matching FotMob match ID.
 */
export async function findEventByFotmobId(token, calendarId, matchId) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('privateExtendedProperty', `fotmobMatchId=${String(matchId)}`);
  url.searchParams.set('maxResults', '1');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.items && data.items.length > 0) {
    return data.items[0];
  }
  return null;
}

/**
 * Generate fallback 1-click Google Calendar web template URL.
 */
export function buildWebCalendarUrl(match, settings) {
  const kickoff = new Date(match.kickoff);
  const durationMin = parseInt(settings?.durationMinutes || 115, 10);
  const endTime = new Date(kickoff.getTime() + durationMin * 60000);

  const formatGcalDate = (d) => {
    return d.toISOString().replace(/-|:|\.\d\d\d/g, '');
  };

  const datesParam = `${formatGcalDate(kickoff)}/${formatGcalDate(endTime)}`;

  let title = settings?.titleFormat || '⚽ {home} vs {away} ({league})';
  title = title
    .replace('{home}', match.homeTeam || 'Home')
    .replace('{away}', match.awayTeam || 'Away')
    .replace('{league}', match.league || '')
    .replace('{round}', match.round || '')
    .trim();

  const desc = [
    match.league ? `Competition: ${match.league}` : '',
    match.round ? `Round: ${match.round}` : '',
    match.venue ? `Venue: ${match.venue}` : '',
    match.url ? `FotMob: ${match.url}` : ''
  ].filter(Boolean).join('\n');

  const gcalUrl = new URL('https://calendar.google.com/calendar/render');
  gcalUrl.searchParams.set('action', 'TEMPLATE');
  gcalUrl.searchParams.set('text', title);
  gcalUrl.searchParams.set('dates', datesParam);
  gcalUrl.searchParams.set('details', desc);
  if (match.venue) {
    gcalUrl.searchParams.set('location', match.venue);
  }

  return gcalUrl.toString();
}
