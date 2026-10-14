// options/options.js
import { getSettings, saveSettings, GCAL_COLORS, getSyncedMatches } from '../utils/storage.js';

let currentSettings = {};

document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  setupNavigation();
  setupAuthControls();
  setupCalendarControls();
  setupRemindersControls();
  setupStylingControls();
  setupSyncedMatches();
});

async function initSettings() {
  currentSettings = await getSettings();

  // Populate inputs
  document.getElementById('clientIdInput').value = currentSettings.clientId || '';
  document.getElementById('durationSlider').value = currentSettings.durationMinutes || 115;
  document.getElementById('durationValText').textContent = currentSettings.durationMinutes || 115;
  document.getElementById('toggleVenue').checked = currentSettings.includeVenue !== false;
  document.getElementById('toggleFotmobUrl').checked = currentSettings.includeFotmobUrl !== false;
  document.getElementById('toggleRound').checked = currentSettings.includeRoundInfo !== false;
  document.getElementById('titleFormatInput').value = currentSettings.titleFormat || '⚽ {home} vs {away} ({league})';

  // Check auth status
  await refreshAuthStatus();
  renderColorPalette();
  renderReminders();
  updateLivePreview();
}

/**
 * Tab Navigation
 */
function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const titles = {
    account: { title: 'Google Account & OAuth Setup', sub: 'Connect your Google Calendar to enable instant 1-click sync from FotMob.' },
    calendar: { title: 'Target Calendar & Event Defaults', sub: 'Choose destination calendar and match duration preferences.' },
    reminders: { title: 'Kickoff Reminders', sub: 'Set default notifications so you never miss a match.' },
    styling: { title: 'Colors & Title Format', sub: 'Customize how events look inside your Google Calendar.' },
    synced: { title: 'Synced Matches History', sub: 'View and manage all matches synced via this extension.' }
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById(`pane-${target}`).classList.add('active');

      if (titles[target]) {
        document.getElementById('pageTitle').textContent = titles[target].title;
        document.getElementById('pageSubtitle').textContent = titles[target].sub;
      }

      if (target === 'synced') {
        renderSyncedMatches();
      }
    });
  });
}

/**
 * Auth & Connection Controls
 */
function setupAuthControls() {
  const btnConnect = document.getElementById('btnConnectGoogle');
  const btnDisconnect = document.getElementById('btnDisconnect');
  const btnSaveClientId = document.getElementById('btnSaveClientId');
  const btnCopyUri = document.getElementById('btnCopyUri');

  btnConnect.addEventListener('click', async () => {
    btnConnect.disabled = true;
    btnConnect.textContent = 'Connecting...';
    try {
      const res = await sendMessage('AUTH_CONNECT');
      if (res.success) {
        await refreshAuthStatus();
        await loadCalendars();
      } else {
        alert('Authentication failed: ' + (res.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Error during login: ' + e.message);
    } finally {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
        Connect Google Account
      `;
    }
  });

  btnDisconnect.addEventListener('click', async () => {
    if (confirm('Disconnect your Google account from the extension?')) {
      await sendMessage('AUTH_DISCONNECT');
      await refreshAuthStatus();
    }
  });

  btnSaveClientId.addEventListener('click', async () => {
    const val = document.getElementById('clientIdInput').value.trim();
    currentSettings.clientId = val;
    await saveSettings(currentSettings);
    flashSaved();
    alert('Client ID saved! Click "Connect Google Account" to sign in.');
  });

  btnCopyUri.addEventListener('click', () => {
    const uri = document.getElementById('redirectUriDisplay').textContent;
    navigator.clipboard.writeText(uri).then(() => {
      btnCopyUri.textContent = 'Copied!';
      setTimeout(() => (btnCopyUri.textContent = 'Copy'), 2000);
    });
  });
}

async function refreshAuthStatus() {
  const statusRes = await sendMessage('AUTH_STATUS');
  const badge = document.getElementById('authStatusBadge');
  const connectedView = document.getElementById('connectedView');
  const disconnectedView = document.getElementById('disconnectedView');

  if (statusRes.success && statusRes.data?.isAuthenticated) {
    badge.textContent = 'Connected';
    badge.className = 'status-pill connected';
    connectedView.classList.remove('hidden');
    disconnectedView.classList.add('hidden');

    const user = statusRes.data.user || {};
    document.getElementById('userName').textContent = user.name || 'Connected Google User';
    document.getElementById('userEmail').textContent = user.email || '';
    if (user.picture) {
      document.getElementById('userAvatar').src = user.picture;
    }

    await loadCalendars();
  } else {
    badge.textContent = 'Not Connected';
    badge.className = 'status-pill disconnected';
    connectedView.classList.add('hidden');
    disconnectedView.classList.remove('hidden');
  }
}

/**
 * Calendar Selection & Defaults
 */
function setupCalendarControls() {
  const select = document.getElementById('calendarSelect');
  const btnRefresh = document.getElementById('btnRefreshCalendars');
  const durationSlider = document.getElementById('durationSlider');
  const durationValText = document.getElementById('durationValText');

  select.addEventListener('change', async () => {
    currentSettings.selectedCalendarId = select.value;
    currentSettings.selectedCalendarName = select.options[select.selectedIndex]?.text || 'Calendar';
    await saveSettings(currentSettings);
    flashSaved();
  });

  btnRefresh.addEventListener('click', () => loadCalendars());

  durationSlider.addEventListener('input', async () => {
    durationValText.textContent = durationSlider.value;
    currentSettings.durationMinutes = parseInt(durationSlider.value, 10);
    await saveSettings(currentSettings);
    updateLivePreview();
    flashSaved();
  });

  ['toggleVenue', 'toggleFotmobUrl', 'toggleRound'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      currentSettings.includeVenue = document.getElementById('toggleVenue').checked;
      currentSettings.includeFotmobUrl = document.getElementById('toggleFotmobUrl').checked;
      currentSettings.includeRoundInfo = document.getElementById('toggleRound').checked;
      await saveSettings(currentSettings);
      updateLivePreview();
      flashSaved();
    });
  });
}

async function loadCalendars() {
  const select = document.getElementById('calendarSelect');
  try {
    const res = await sendMessage('GET_CALENDARS');
    if (res.success && Array.isArray(res.data)) {
      select.innerHTML = '';
      res.data.forEach((cal) => {
        const opt = document.createElement('option');
        opt.value = cal.id;
        opt.textContent = `${cal.summary}${cal.primary ? ' (Primary)' : ''}`;
        if (cal.id === currentSettings.selectedCalendarId) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('Could not load calendars:', e);
  }
}

/**
 * Reminders
 */
function setupRemindersControls() {
  const btnAdd = document.getElementById('btnAddReminder');
  btnAdd.addEventListener('click', async () => {
    const mins = parseInt(document.getElementById('newReminderMinutes').value, 10);
    const method = document.getElementById('newReminderMethod').value;

    if (!Array.isArray(currentSettings.reminders)) {
      currentSettings.reminders = [];
    }

    currentSettings.reminders.push({ minutes: mins, method });
    await saveSettings(currentSettings);
    renderReminders();
    flashSaved();
  });
}

function renderReminders() {
  const list = document.getElementById('remindersList');
  list.innerHTML = '';

  const reminders = currentSettings.reminders || [];
  if (reminders.length === 0) {
    list.innerHTML = '<p class="field-hint">No custom reminders set (uses Google Calendar defaults).</p>';
    return;
  }

  reminders.forEach((r, idx) => {
    const item = document.createElement('div');
    item.className = 'reminder-item';

    const minText = r.minutes >= 1440 
      ? `${Math.round(r.minutes / 1440)} day before`
      : r.minutes >= 60 
      ? `${Math.round(r.minutes / 60)} hour before`
      : `${r.minutes} minutes before`;

    const icon = r.method === 'email' ? '✉️ Email' : '🔔 Notification';

    item.innerHTML = `
      <div class="reminder-info">
        <span>${icon}</span>
        <span>${minText}</span>
      </div>
      <button class="reminder-remove" data-idx="${idx}" title="Remove reminder">✕</button>
    `;

    item.querySelector('.reminder-remove').addEventListener('click', async () => {
      currentSettings.reminders.splice(idx, 1);
      await saveSettings(currentSettings);
      renderReminders();
      flashSaved();
    });

    list.appendChild(item);
  });
}

/**
 * Styling & Live Preview
 */
function setupStylingControls() {
  const titleInput = document.getElementById('titleFormatInput');

  titleInput.addEventListener('input', async () => {
    currentSettings.titleFormat = titleInput.value;
    await saveSettings(currentSettings);
    updateLivePreview();
    flashSaved();
  });

  // Token Tag Chips
  document.querySelectorAll('.tag-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const tag = chip.dataset.insert;
      titleInput.value += ` ${tag}`;
      currentSettings.titleFormat = titleInput.value;
      await saveSettings(currentSettings);
      updateLivePreview();
      flashSaved();
    });
  });
}

function renderColorPalette() {
  const container = document.getElementById('colorPalette');
  container.innerHTML = '';

  const selectedColorId = currentSettings.eventColorId || '10';

  GCAL_COLORS.forEach((c) => {
    const opt = document.createElement('div');
    opt.className = `color-option ${c.id === selectedColorId ? 'selected' : ''}`;
    opt.innerHTML = `
      <div class="color-dot" style="background-color: ${c.hex}"></div>
      <span class="color-name">${c.name}</span>
    `;

    opt.addEventListener('click', async () => {
      container.querySelectorAll('.color-option').forEach((el) => el.classList.remove('selected'));
      opt.classList.add('selected');
      currentSettings.eventColorId = c.id;
      await saveSettings(currentSettings);
      updateLivePreview();
      flashSaved();
    });

    container.appendChild(opt);
  });
}

function updateLivePreview() {
  const colorId = currentSettings.eventColorId || '10';
  const colorObj = GCAL_COLORS.find((c) => c.id === colorId) || GCAL_COLORS[9];
  document.getElementById('previewColorBar').style.backgroundColor = colorObj.hex;

  let title = currentSettings.titleFormat || '⚽ {home} vs {away} ({league})';
  title = title
    .replace('{home}', 'Arsenal')
    .replace('{away}', 'Chelsea')
    .replace('{league}', 'Premier League')
    .replace('{round}', 'Matchday 9')
    .trim();

  document.getElementById('previewTitle').textContent = title;

  const duration = currentSettings.durationMinutes || 115;
  document.getElementById('previewTime').textContent = `Sunday, Oct 25 · 17:30 - ${formatEndTime('17:30', duration)}`;

  const venueElem = document.getElementById('previewVenue');
  if (currentSettings.includeVenue !== false) {
    venueElem.style.display = 'block';
    venueElem.textContent = '🏟️ Emirates Stadium, London';
  } else {
    venueElem.style.display = 'none';
  }
}

function formatEndTime(startStr, durationMin) {
  const [h, m] = startStr.split(':').map(Number);
  const totalMin = h * 60 + m + durationMin;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Synced Matches Table
 */
async function setupSyncedMatches() {
  const btnClear = document.getElementById('btnClearAllSynced');
  btnClear.addEventListener('click', async () => {
    if (confirm('Clear local sync records? (Matches already on your Google Calendar will remain on Google Calendar).')) {
      chrome.storage.local.set({ fotmob_synced_matches: {} }, () => {
        renderSyncedMatches();
        flashSaved();
      });
    }
  });

  await renderSyncedMatches();
}

async function renderSyncedMatches() {
  const synced = await getSyncedMatches();
  const list = Object.values(synced || {});
  const badge = document.getElementById('syncedCountBadge');
  const emptyState = document.getElementById('syncedEmptyState');
  const tableContainer = document.getElementById('syncedTableContainer');
  const tbody = document.getElementById('syncedTableBody');

  badge.textContent = list.length;

  if (list.length === 0) {
    emptyState.classList.remove('hidden');
    tableContainer.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  tableContainer.classList.remove('hidden');
  tbody.innerHTML = '';

  // Sort descending by kickoff or added time
  list.sort((a, b) => new Date(b.kickoff || b.addedAt) - new Date(a.kickoff || a.addedAt));

  list.forEach((m) => {
    const tr = document.createElement('tr');
    const kickDate = m.kickoff ? new Date(m.kickoff).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'TBD';

    tr.innerHTML = `
      <td class="match-name-cell">${escapeHtml(m.homeTeam || 'Home')} vs ${escapeHtml(m.awayTeam || 'Away')}</td>
      <td>${escapeHtml(m.league || 'Football')}</td>
      <td>${kickDate}</td>
      <td>
        <button class="btn btn-danger btn-sm btn-remove-synced" data-match-id="${m.matchId}">Remove</button>
      </td>
    `;

    tr.querySelector('.btn-remove-synced').addEventListener('click', async () => {
      tr.style.opacity = '0.5';
      await sendMessage('REMOVE_MATCH', { matchId: m.matchId });
      await renderSyncedMatches();
      flashSaved();
    });

    tbody.appendChild(tr);
  });
}

function flashSaved() {
  const el = document.getElementById('saveFeedback');
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.opacity = '0.7';
  }, 2000);
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      resolve(res || { success: false });
    });
  });
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
