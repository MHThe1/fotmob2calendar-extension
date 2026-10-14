// content/content.js - FotMob to Google Calendar 1-Click Sync Content Script

(function () {
  'use strict';

  // SVG Icons
  const ICONS = {
    calendarAdd: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
        <line x1="12" y1="14" x2="12" y2="18"></line>
        <line x1="10" y1="16" x2="14" y2="16"></line>
      </svg>`,
    calendarCheck: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
        <polyline points="9 16 11 18 15 14"></polyline>
      </svg>`,
    trash: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>`
  };

  // State cache for match synced status on current page
  const syncedStateMap = new Map();
  let toastContainer = null;
  let scanDebounceTimer = null;

  /**
   * Initialize Toast Container
   */
  function ensureToastContainer() {
    if (!toastContainer || !document.body.contains(toastContainer)) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'f2c-toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  /**
   * Display modern toast feedback
   */
  function showToast({ title, message, type = 'success', actionText, onAction }) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'f2c-toast';

    const iconType = type === 'remove' ? 'remove' : type === 'warn' ? 'warn' : 'success';
    const iconSymbol = type === 'remove' ? '🗑️' : type === 'warn' ? '⚠️' : '⚽';

    toast.innerHTML = `
      <div class="f2c-toast-icon ${iconType}">${iconSymbol}</div>
      <div class="f2c-toast-content">
        <div class="f2c-toast-title">${escapeHtml(title)}</div>
        <div class="f2c-toast-desc">${escapeHtml(message)}</div>
      </div>
    `;

    if (actionText && onAction) {
      const btn = document.createElement('button');
      btn.className = 'f2c-toast-btn';
      btn.textContent = actionText;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction();
      });
      toast.appendChild(btn);
    }

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('f2c-toast-out');
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  /**
   * Extract all possible candidate Match IDs (numeric hash, slug ID, path ID)
   */
  function extractMatchCandidateIds(urlOrText) {
    if (!urlOrText) return [];
    const candidates = [];

    // 1. Numeric hash: #6106309
    const hashMatch = urlOrText.match(/#(\d+)/);
    if (hashMatch && !candidates.includes(hashMatch[1])) {
      candidates.push(hashMatch[1]);
    }

    // 2. Query param: ?matchId=12345
    const qMatch = urlOrText.match(/[?&]matchId=([a-zA-Z0-9]+)/i);
    if (qMatch && !candidates.includes(qMatch[1])) {
      candidates.push(qMatch[1]);
    }

    // 3. Path segments from /matches/como-vs-feyenoord/3fyxs8 or /match/4667820
    const cleanUrl = urlOrText.split('?')[0].split('#')[0];
    const matchPath = cleanUrl.match(/\/match(?:es)?\/(?:[^\/]+\/)?([a-zA-Z0-9]+)/i);
    if (matchPath && !candidates.includes(matchPath[1])) {
      candidates.push(matchPath[1]);
    }

    return candidates;
  }

  /**
   * Primary single ID extractor for tagging DOM elements
   */
  function extractMatchId(urlOrText) {
    const list = extractMatchCandidateIds(urlOrText);
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Send message to Chrome extension background worker
   */
  function sendMessage(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { success: false, error: 'Empty response' });
        }
      });
    });
  }

  /**
   * Direct same-origin fetch from the page itself (has user's active session & Cloudflare clearance)
   */
  async function fetchFotmobMatchApi(id) {
    try {
      const res = await fetch(`/api/matchDetails?matchId=${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && (data.general || data.header)) {
          return data;
        }
      }
    } catch (err) {
      console.warn('Same-origin API fetch error for ID', id, err);
    }
    return null;
  }

  /**
   * Search page's __NEXT_DATA__ payload for the match object
   */
  function findMatchInNextData(candidateIds) {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script) return null;
    try {
      const json = JSON.parse(script.textContent);
      const idSet = new Set(Array.from(candidateIds).map(String));

      function search(obj, depth = 0) {
        if (!obj || depth > 14 || typeof obj !== 'object') return null;

        // Match signature: has id, plus status or home/away
        if (obj.id && idSet.has(String(obj.id))) {
          if (obj.status?.utcTime || obj.timeTS || obj.home || obj.homeTeam) {
            return obj;
          }
        }

        // Match signature: check pageUrl or slug
        if (obj.pageUrl) {
          for (const cid of idSet) {
            if (obj.pageUrl.includes(cid)) return obj;
          }
        }

        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = search(item, depth + 1);
            if (found) return found;
          }
        } else {
          for (const k of Object.keys(obj)) {
            const found = search(obj[k], depth + 1);
            if (found) return found;
          }
        }
        return null;
      }

      return search(json);
    } catch (e) {
      console.warn('Error reading __NEXT_DATA__:', e);
    }
    return null;
  }

  const MONTH_NAMES = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  /**
   * Check if a string represents a table or group date header
   * Examples: "Today", "Tomorrow", "Tuesday, October 20", "Saturday, October 17"
   */
  function isDateHeaderText(text) {
    if (!text) return false;
    const clean = text.trim();
    if (clean.length < 3 || clean.length > 55) return false;

    // Relative dates
    if (/^(today|tomorrow|yesterday)$/i.test(clean) || /\b(today|tomorrow|yesterday)\b/i.test(clean)) {
      return true;
    }

    // Month + Day or Day + Month patterns
    const hasMonth = Object.keys(MONTH_NAMES).some(m => new RegExp(`\\b${m}\\b`, 'i').test(clean));
    const hasDayNum = /\b\d{1,2}\b/.test(clean);

    return hasMonth && hasDayNum;
  }

  /**
   * Traverse up the DOM to locate the table or section date header for a fixture row
   */
  function findDateHeaderForElement(element) {
    if (!element) return null;

    let current = element;
    for (let depth = 0; depth < 12 && current && current !== document.body; depth++) {
      // 1. Check previous siblings of this container or row
      let prev = current.previousElementSibling;
      while (prev) {
        const prevDirect = prev.textContent.trim();
        if (isDateHeaderText(prevDirect)) {
          return prevDirect;
        }

        const innerHeaders = prev.querySelectorAll('h1, h2, h3, h4, h5, [class*="Header" i], [class*="header" i], [class*="date" i], [class*="Date" i], time');
        for (const h of innerHeaders) {
          const ht = h.textContent.trim();
          if (isDateHeaderText(ht)) {
            return ht;
          }
        }
        prev = prev.previousElementSibling;
      }

      // 2. Check if current ancestor itself has a header element
      const containerHeaders = current.querySelectorAll('h1, h2, h3, h4, [class*="Header" i], [class*="header" i], [class*="title" i], [class*="Title" i]');
      for (const ch of containerHeaders) {
        if (!ch.contains(element) && !element.contains(ch)) {
          const ct = ch.textContent.trim();
          if (isDateHeaderText(ct)) {
            return ct;
          }
        }
      }

      current = current.parentElement;
    }

    // 3. Fallback: check active datepicker button on FotMob top bar (e.g. "Today", "Wed 14 Oct")
    const activeDatepicker = document.querySelector(
      '[class*="Datepicker" i] [aria-selected="true"], [class*="datepicker" i] [data-selected="true"], [class*="DatePicker" i] button.active, [aria-label*="selected date" i]'
    );
    if (activeDatepicker) {
      const text = activeDatepicker.textContent.trim();
      if (isDateHeaderText(text)) return text;
    }

    return null;
  }

  /**
   * Parse a date header string into a Date object
   * Examples: "Tuesday, October 20" -> Date(2026, 9, 20), "Today" -> today, "Tomorrow" -> tomorrow
   */
  function parseDateHeader(text) {
    if (!text) return null;
    const now = new Date();
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // Relative dates
    if (lower.includes('today')) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (lower.includes('tomorrow')) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() + 1);
      return d;
    }
    if (lower.includes('yesterday')) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() - 1);
      return d;
    }

    // Month + Day: e.g. "Tuesday, October 20" or "October 20, 2026" or "Oct 20"
    const m1 = lower.match(/\b([a-z]{3,9})\b\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
    if (m1 && MONTH_NAMES[m1[1]] !== undefined) {
      const month = MONTH_NAMES[m1[1]];
      const day = parseInt(m1[2], 10);
      const year = m1[3] ? parseInt(m1[3], 10) : now.getFullYear();
      const d = new Date(year, month, day);
      if (!m1[3] && d.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 180) {
        d.setFullYear(year + 1);
      }
      return d;
    }

    // Day + Month: e.g. "20 October" or "14 Oct 2026"
    const m2 = lower.match(/(\d{1,2})\s+\b([a-z]{3,9})\b(?:,?\s+(\d{4}))?/);
    if (m2 && MONTH_NAMES[m2[2]] !== undefined) {
      const day = parseInt(m2[1], 10);
      const month = MONTH_NAMES[m2[2]];
      const year = m2[3] ? parseInt(m2[3], 10) : now.getFullYear();
      const d = new Date(year, month, day);
      if (!m2[3] && d.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 180) {
        d.setFullYear(year + 1);
      }
      return d;
    }

    // Standard parse fallback with current year
    try {
      const cleanNoDay = clean.replace(/^[A-Za-z]+,\s*/, '');
      const withYear = cleanNoDay.includes(String(now.getFullYear())) ? cleanNoDay : `${cleanNoDay}, ${now.getFullYear()}`;
      const d = new Date(withYear);
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}

    return null;
  }

  /**
   * Extract kickoff time string from a fixture row
   * Examples: "1:00 AM", "5:30 PM", "10:45 PM", "19:45"
   */
  function extractKickoffTimeFromRow(anchorElement) {
    if (!anchorElement) return null;

    // A. Check aria-label first: e.g. "Everton 5:30 PM Chelsea"
    const aria = anchorElement.getAttribute('aria-label') || '';
    const ariaTimeMatch = aria.match(/\b(\d{1,2}:\d{2}\s*(?:[AP]M)?)\b/i);
    if (ariaTimeMatch) return ariaTimeMatch[1].trim();

    // B. Check row innerText (e.g. "1:00\nAM" or "5:30 PM")
    const text = anchorElement.innerText || '';
    const textTimeMatch = text.match(/\b(\d{1,2}:\d{2})\s*([AP]M)?\b/i);
    if (textTimeMatch) {
      return textTimeMatch[2] ? `${textTimeMatch[1]} ${textTimeMatch[2]}`.trim() : textTimeMatch[1].trim();
    }

    // C. Check child spans or time tags
    const timeSpans = anchorElement.querySelectorAll('time, [class*="time" i], [class*="Time" i], span, div');
    for (const el of timeSpans) {
      const t = el.textContent.trim();
      const m = t.match(/^(\d{1,2}:\d{2})\s*([AP]M)?$/i);
      if (m) {
        return m[2] ? `${m[1]} ${m[2]}`.trim() : m[1].trim();
      }
    }

    return null;
  }

  /**
   * Combine a base date with a kickoff time string
   */
  function combineDateAndKickoff(baseDate, timeStr) {
    if (!baseDate || !timeStr) return null;
    const d = new Date(baseDate);

    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    if (!m) return null;

    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const ampm = m[3] ? m[3].toUpperCase() : null;

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  /**
   * Extract kickoff time and team names directly from a fixture row and its table header
   */
  function extractFixtureRowDetails(anchorElement) {
    if (!anchorElement) return null;

    // 1. Kickoff Time from row
    const timeStr = extractKickoffTimeFromRow(anchorElement);
    if (!timeStr) return null;

    // 2. Date from Table / Section Header
    const dateHeaderText = findDateHeaderForElement(anchorElement);
    const baseDate = parseDateHeader(dateHeaderText);

    let kickoffDate = null;
    if (baseDate) {
      kickoffDate = combineDateAndKickoff(baseDate, timeStr);
    }

    // Fallback: check if aria-label itself has a full date (e.g. "May 17, 2026")
    if (!kickoffDate) {
      const aria = anchorElement.getAttribute('aria-label') || '';
      const fullDateMatch = aria.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}/i);
      if (fullDateMatch) {
        const parsed = new Date(`${fullDateMatch[0]} ${timeStr}`);
        if (!isNaN(parsed.getTime())) kickoffDate = parsed;
      }
    }

    if (!kickoffDate || isNaN(kickoffDate.getTime())) return null;

    // 3. Extract team names
    const aria = anchorElement.getAttribute('aria-label') || '';
    let homeTeam = 'Home Team';
    let awayTeam = 'Away Team';

    const ariaTeamsMatch = aria.match(/^(.+?)\s+\d{1,2}:\d{2}\s*(?:[AP]M)?\s+(.+?)(?:,|$)/i);
    const vsMatch = aria.match(/^(.+?)\s+(?:vs\.?|–|-)\s+(.+?)(?:,|$)/i);

    if (ariaTeamsMatch) {
      homeTeam = ariaTeamsMatch[1].trim();
      awayTeam = ariaTeamsMatch[2].trim();
    } else if (vsMatch) {
      homeTeam = vsMatch[1].trim();
      awayTeam = vsMatch[2].trim();
    } else {
      const lines = (anchorElement.innerText || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 1 && !l.match(/^\d/) && !l.includes(':') && !/^(am|pm|ft|ht)$/i.test(l));
      if (lines.length >= 2) {
        homeTeam = lines[0];
        awayTeam = lines[1];
      }
    }

    return {
      homeTeam,
      awayTeam,
      kickoff: kickoffDate.toISOString()
    };
  }

  /**
   * Parse Kickoff Time and Match Metadata with multiple resilient layers
   */
  async function resolveMatchDetails(matchId, anchorElement = null) {
    // Collect all candidate IDs from element href and current window URL
    const candidateIds = new Set();
    if (matchId) candidateIds.add(matchId);

    if (anchorElement) {
      const href = anchorElement.getAttribute('href') || '';
      extractMatchCandidateIds(href).forEach(id => candidateIds.add(id));
    }

    extractMatchCandidateIds(window.location.href).forEach(id => candidateIds.add(id));

    // LAYER 1: Table Header + Row Kickoff Time (Direct, exact match for fixture lists)
    if (anchorElement) {
      const rowDetails = extractFixtureRowDetails(anchorElement);
      if (rowDetails) {
        // Look up tournament or extra details from NEXT_DATA if available
        const nextMatch = findMatchInNextData(candidateIds);
        return {
          id: String(matchId),
          homeTeam: rowDetails.homeTeam,
          awayTeam: rowDetails.awayTeam,
          league: nextMatch?.tournament?.name || nextMatch?.league?.name || '',
          round: nextMatch?.round || '',
          venue: nextMatch?.venue?.name || '',
          kickoff: rowDetails.kickoff,
          url: anchorElement.href || (window.location.origin + `/match/${matchId}`)
        };
      }
    }

    // LAYER 2: Inspect page's __NEXT_DATA__ props (Authoritative UTC for all loaded fixtures)
    const nextMatch = findMatchInNextData(candidateIds);
    if (nextMatch) {
      const utc = nextMatch.status?.utcTime || nextMatch.timeTS || nextMatch.status?.startTimeUtc;
      if (utc) {
        const parsedDate = new Date(utc);
        if (!isNaN(parsedDate.getTime())) {
          return {
            id: String(nextMatch.id || matchId),
            homeTeam: nextMatch.home?.name || nextMatch.homeTeam?.name || 'Home Team',
            awayTeam: nextMatch.away?.name || nextMatch.awayTeam?.name || 'Away Team',
            league: nextMatch.tournament?.name || nextMatch.league?.name || '',
            round: nextMatch.round || nextMatch.matchday || '',
            venue: nextMatch.venue?.name || '',
            kickoff: parsedDate.toISOString(),
            url: window.location.origin + `/match/${nextMatch.id || matchId}`
          };
        }
      }
    }

    // LAYER 3: Query FotMob's API directly from the page context (for matches near matchday)
    for (const id of candidateIds) {
      const data = await fetchFotmobMatchApi(id);
      if (data && data.general) {
        const gen = data.general;
        const rawUtc = gen.matchTimeUTCDate || gen.matchTimeUTC;
        if (rawUtc) {
          const parsedDate = new Date(rawUtc);
          if (!isNaN(parsedDate.getTime())) {
            const finalId = String(gen.matchId || id);
            return {
              id: finalId,
              homeTeam: gen.homeTeam?.name || gen.homeTeam?.nameShort || 'Home Team',
              awayTeam: gen.awayTeam?.name || gen.awayTeam?.nameShort || 'Away Team',
              league: gen.leagueName || gen.parentLeagueName || data.header?.status?.leagueName || '',
              round: gen.round || gen.matchDay || '',
              venue: gen.venue?.name || '',
              kickoff: parsedDate.toISOString(),
              url: window.location.origin + `/match/${finalId}`
            };
          }
        }
      }
    }

    // LAYER 4: Parse Schema.org JSON-LD Structured Data on Match Detail Page
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const event = data['@type'] === 'SportsEvent' ? data : (data['@graph'] || []).find(i => i['@type'] === 'SportsEvent');
        if (event && event.startDate) {
          const parsedDate = new Date(event.startDate);
          if (!isNaN(parsedDate.getTime())) {
            return {
              id: String(matchId),
              homeTeam: event.homeTeam?.name || 'Home Team',
              awayTeam: event.awayTeam?.name || 'Away Team',
              league: event.superEvent?.name || '',
              round: '',
              venue: event.location?.name || '',
              kickoff: parsedDate.toISOString(),
              url: event.url || window.location.href
            };
          }
        }
      } catch (err) {}
    }

    // LAYER 5: Parse SEO Meta description UTC patterns (e.g. "... on Wed, Oct 14, 2026, 16:45 UTC.")
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                     document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
    const utcTimeMatch = metaDesc.match(/(\b\d{1,2}:\d{2}\b)\s*UTC/i);
    const dateMatch = metaDesc.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}/i);
    if (utcTimeMatch && dateMatch) {
      const combined = `${dateMatch[0]} ${utcTimeMatch[1]} UTC`;
      const parsedDate = new Date(combined);
      if (!isNaN(parsedDate.getTime())) {
        return {
          id: String(matchId),
          homeTeam: extractTeamsFromPage()[0] || 'Home Team',
          awayTeam: extractTeamsFromPage()[1] || 'Away Team',
          league: '',
          round: '',
          venue: '',
          kickoff: parsedDate.toISOString(),
          url: window.location.href
        };
      }
    }

    // LAYER 6: Parse DOM Header Date & Time Text on Match Page
    const headerDateText = findMatchHeaderDateTimeText();
    if (headerDateText) {
      const parsedDate = parseFotmobDateString(headerDateText);
      if (parsedDate && !isNaN(parsedDate.getTime())) {
        const teams = extractTeamsFromPage();
        return {
          id: String(matchId),
          homeTeam: teams[0] || 'Home Team',
          awayTeam: teams[1] || 'Away Team',
          league: '',
          round: '',
          venue: '',
          kickoff: parsedDate.toISOString(),
          url: window.location.href
        };
      }
    }

    // STRICT GUARD: We NEVER fall back to current time. If kick-off is unknown, fail cleanly.
    throw new Error('Could not verify match kickoff start time. Please make sure the match is scheduled and try refreshing.');
  }

  /**
   * Helper to extract home and away team names from match page
   */
  function extractTeamsFromPage() {
    const titles = Array.from(document.querySelectorAll('h1, h2, [class*="TeamTitle"], [class*="teamName"]'))
      .map(el => el.textContent.trim())
      .filter(Boolean);

    // Look for "Team A vs Team B" in h1
    const h1 = document.querySelector('h1')?.textContent || '';
    if (h1.includes(' vs ')) {
      const parts = h1.split(' vs ');
      return [parts[0].trim(), parts[1].trim()];
    }

    return [titles[0] || 'Home', titles[1] || 'Away'];
  }

  /**
   * Helper to locate formatted date/time text in match header
   */
  function findMatchHeaderDateTimeText() {
    // Look for text matching "Oct 14", "10:45 PM", etc.
    const allSpans = Array.from(document.querySelectorAll('header span, header div, main header *'));
    for (const el of allSpans) {
      const text = el.textContent.trim();
      if (text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}.*?\d{1,2}:\d{2}/i)) {
        return text;
      }
    }
    return null;
  }

  /**
   * Parse FotMob human-readable date strings (e.g. "Wed, October 14, 10:45 PM")
   */
  function parseFotmobDateString(str) {
    try {
      const currentYear = new Date().getFullYear();
      // Remove day of week ("Wed, ")
      const clean = str.replace(/^[A-Za-z]+,\s*/, '');
      const withYear = clean.includes(String(currentYear)) ? clean : `${clean}, ${currentYear}`;
      const d = new Date(withYear);
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}
    return null;
  }

  /**
   * Handle Click on Add / Remove Button
   */
  async function handleButtonClick(button, matchId, anchorElement = null) {
    if (button.classList.contains('f2c-loading')) return;

    const isCurrentlySynced = syncedStateMap.get(matchId) || button.classList.contains('f2c-synced');

    // Set Loading State
    button.classList.add('f2c-loading');
    const originalHtml = button.innerHTML;
    button.innerHTML = '<span class="f2c-spinner"></span>';

    try {
      if (isCurrentlySynced) {
        // REMOVE EVENT
        const res = await sendMessage('REMOVE_MATCH', { matchId });
        if (res.success) {
          syncedStateMap.set(matchId, false);
          updateAllButtonsForMatch(matchId, false);
          showToast({
            title: 'Match Removed',
            message: 'Event was successfully removed from your Google Calendar.',
            type: 'remove'
          });
        } else {
          throw new Error(res.error || 'Failed to remove match.');
        }
      } else {
        // ADD EVENT - Resolve authoritative kick-off start time
        const matchData = await resolveMatchDetails(matchId, anchorElement);

        const kickoffDate = new Date(matchData.kickoff);
        const formattedTime = kickoffDate.toLocaleDateString([], { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit', 
          minute: '2-digit' 
        });

        const res = await sendMessage('ADD_MATCH', { match: matchData });

        if (res.success && res.data) {
          if (res.data.needsSetup) {
            // OAuth not yet connected: provide instant direct Google Calendar web link fallback
            showToast({
              title: 'OAuth Setup Needed',
              message: res.data.message,
              type: 'warn',
              actionText: 'Add via Web Link',
              onAction: () => {
                if (res.data.fallbackUrl) window.open(res.data.fallbackUrl, '_blank');
              }
            });
            button.innerHTML = originalHtml;
            button.classList.remove('f2c-loading');
            return;
          }

          syncedStateMap.set(matchId, true);
          updateAllButtonsForMatch(matchId, true);
          showToast({
            title: 'Added to Calendar! ⚽',
            message: `${matchData.homeTeam} vs ${matchData.awayTeam} scheduled for ${formattedTime}.`,
            type: 'success',
            actionText: 'View',
            onAction: () => {
              if (res.data.htmlLink) window.open(res.data.htmlLink, '_blank');
            }
          });
        } else {
          throw new Error(res.error || 'Failed to add match.');
        }
      }
    } catch (err) {
      console.error('Error during calendar action:', err);
      showToast({
        title: 'Action Failed',
        message: err.message || 'Could not update Google Calendar.',
        type: 'warn'
      });
      button.innerHTML = originalHtml;
    } finally {
      button.classList.remove('f2c-loading');
    }
  }

  /**
   * Update button UI to synced or un-synced state
   */
  function setButtonState(button, isSynced) {
    const isHeader = button.classList.contains('f2c-btn-header');

    if (isSynced) {
      button.classList.add('f2c-synced');
      if (isHeader) {
        button.innerHTML = `${ICONS.calendarCheck}<span>In Calendar</span>`;
        button.setAttribute('data-f2c-tooltip', 'Click to remove from Google Calendar');
      } else {
        button.innerHTML = ICONS.calendarCheck;
        button.setAttribute('data-f2c-tooltip', 'In Calendar (Click to remove)');
      }
    } else {
      button.classList.remove('f2c-synced');
      if (isHeader) {
        button.innerHTML = `${ICONS.calendarAdd}<span>Add to Calendar</span>`;
        button.setAttribute('data-f2c-tooltip', 'Add match kickoff to Google Calendar');
      } else {
        button.innerHTML = ICONS.calendarAdd;
        button.setAttribute('data-f2c-tooltip', 'Add match to Google Calendar');
      }
    }
  }

  /**
   * Update all buttons matching a matchId across the page
   */
  function updateAllButtonsForMatch(matchId, isSynced) {
    const buttons = document.querySelectorAll(`[data-f2c-match-id="${matchId}"]`);
    buttons.forEach((btn) => setButtonState(btn, isSynced));
  }

  /**
   * Scan and Inject Button on Individual Match Page Header
   */
  function injectMatchHeaderButton() {
    const currentPath = window.location.pathname;
    const currentHash = window.location.hash;
    const matchId = extractMatchId(currentHash) || extractMatchId(currentPath);

    if (!matchId) return;

    // Check if already injected
    if (document.querySelector(`.f2c-btn-header[data-f2c-match-id="${matchId}"]`)) {
      return;
    }

    // Look for header action area (near Star / Bell / Follow buttons)
    const selectors = [
      'header [aria-label*="star" i], header [aria-label*="favorite" i], header [aria-label*="follow" i]',
      'header [aria-label*="notification" i], header [aria-label*="bell" i]',
      'header button',
      'main header',
      '[class*="MatchDetailsHeader"]',
      '[class*="HeaderWrapper"]'
    ];

    let targetContainer = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        targetContainer = el.parentElement;
        break;
      }
    }

    if (!targetContainer) {
      const h1 = document.querySelector('h1');
      if (h1 && h1.parentElement) {
        targetContainer = h1.parentElement;
      }
    }

    if (!targetContainer) return;

    const btn = document.createElement('button');
    btn.className = 'f2c-btn f2c-btn-header';
    btn.setAttribute('data-f2c-match-id', matchId);
    setButtonState(btn, syncedStateMap.get(matchId) || false);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleButtonClick(btn, matchId);
    });

    targetContainer.appendChild(btn);

    // Check sync status immediately
    sendMessage('CHECK_MATCH', { matchId }).then((res) => {
      if (res.success && res.data?.isSynced) {
        syncedStateMap.set(matchId, true);
        setButtonState(btn, true);
      }
    });
  }

  /**
   * Scan and Inject Mini Buttons in Fixture Lists & Tables
   */
  function injectFixtureListButtons() {
    // Find all links to matches
    const matchLinks = document.querySelectorAll('a[href*="/match/"], a[href*="/matches/"]');
    const newMatchIds = new Set();

    matchLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const matchId = extractMatchId(href);
      if (!matchId) return;

      // Don't inject twice on same row
      if (link.dataset.f2cInjected === 'true' || 
          link.querySelector('.f2c-btn-mini') ||
          link.parentElement?.querySelector(`.f2c-btn-mini[data-f2c-match-id="${matchId}"]`)) {
        return;
      }

      link.dataset.f2cInjected = 'true';
      newMatchIds.add(matchId);

      const btn = document.createElement('button');
      btn.className = 'f2c-btn f2c-btn-mini';
      btn.setAttribute('data-f2c-match-id', matchId);
      btn.type = 'button';
      setButtonState(btn, syncedStateMap.get(matchId) || false);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleButtonClick(btn, matchId, link);
      });

      // Insert button subtly beside the match link or follow star button (not inside the link!)
      const starBtn = link.parentElement?.querySelector('button[title*="Follow" i], button[aria-label*="Follow" i], [class*="FollowStar" i]');
      if (starBtn && starBtn.parentElement) {
        starBtn.parentElement.insertBefore(btn, starBtn);
      } else if (link.nextElementSibling) {
        link.parentElement.insertBefore(btn, link.nextElementSibling);
      } else if (link.parentElement) {
        link.parentElement.appendChild(btn);
      } else {
        link.appendChild(btn);
      }
    });

    // Batch query sync status for newly discovered matches
    if (newMatchIds.size > 0) {
      const idsArray = Array.from(newMatchIds);
      sendMessage('CHECK_BATCH_MATCHES', { matchIds: idsArray }).then((res) => {
        if (res.success && res.data) {
          Object.entries(res.data).forEach(([mId, isSynced]) => {
            syncedStateMap.set(mId, isSynced);
            updateAllButtonsForMatch(mId, isSynced);
          });
        }
      });
    }
  }

  /**
   * Run Page Scan
   */
  function scanPage() {
    injectMatchHeaderButton();
    injectFixtureListButtons();
  }

  function scheduleScan() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(scanPage, 200);
  }

  // Observe DOM changes for client-side navigation & infinite scrolling
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) scheduleScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Watch SPA URL changes
  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    scheduleScan();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    scheduleScan();
  };

  window.addEventListener('popstate', scheduleScan);

  // Initial scan on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanPage);
  } else {
    scanPage();
  }
})();
