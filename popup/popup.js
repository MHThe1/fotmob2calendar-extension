// popup/popup.js
import { getSettings, getSyncedMatches } from '../utils/storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadStatus();
  await loadMatches();
  setupListeners();
});

async function loadStatus() {
  const statusRes = await sendMessage('AUTH_STATUS');
  const settings = await getSettings();

  const pill = document.getElementById('authStatusPill');
  const statusText = document.getElementById('authStatusText');
  const userEmailText = document.getElementById('userEmailText');
  const targetCalName = document.getElementById('targetCalName');

  targetCalName.textContent = settings.selectedCalendarName || 'Primary Calendar';

  if (statusRes.success && statusRes.data?.isAuthenticated) {
    pill.className = 'status-pill status-connected';
    statusText.textContent = 'Connected';
    userEmailText.textContent = statusRes.data.user?.email || 'Connected';
  } else {
    pill.className = 'status-pill status-disconnected';
    statusText.textContent = 'Setup Needed';
    userEmailText.textContent = 'Not connected';
  }
}

async function loadMatches() {
  const synced = await getSyncedMatches();
  const list = Object.values(synced || {});
  const countBadge = document.getElementById('syncedCount');
  const container = document.getElementById('matchesList');
  const emptyState = document.getElementById('emptyState');

  countBadge.textContent = list.length;

  if (list.length === 0) {
    emptyState.style.display = 'block';
    // Clear any existing match items except empty state
    Array.from(container.children).forEach((child) => {
      if (child.id !== 'emptyState') child.remove();
    });
    return;
  }

  emptyState.style.display = 'none';
  // Clear any existing match items except empty state
  Array.from(container.children).forEach((child) => {
    if (child.id !== 'emptyState') child.remove();
  });

  // Sort by kickoff / addedAt descending
  list.sort((a, b) => new Date(b.kickoff || b.addedAt) - new Date(a.kickoff || a.addedAt));

  list.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'match-item';

    const kickDate = m.kickoff
      ? new Date(m.kickoff).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Scheduled';

    item.innerHTML = `
      <div class="match-info">
        <span class="match-title" title="Open on FotMob">${escapeHtml(m.homeTeam || 'Home')} vs ${escapeHtml(m.awayTeam || 'Away')}</span>
        <span class="match-sub">${escapeHtml(m.league || 'Match')} · ${kickDate}</span>
      </div>
      <div class="match-actions">
        <button class="btn-icon-remove" title="Remove from Calendar" data-id="${m.matchId}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    // Click title opens match
    item.querySelector('.match-title').addEventListener('click', () => {
      const url = `https://www.fotmob.com/match/${m.matchId}`;
      chrome.tabs.create({ url });
    });

    // Click remove
    item.querySelector('.btn-icon-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      item.style.opacity = '0.4';
      await sendMessage('REMOVE_MATCH', { matchId: m.matchId });
      await loadMatches();
    });

    container.appendChild(item);
  });
}

function setupListeners() {
  document.getElementById('btnOpenOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('authStatusPill').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btnOpenGCal').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://calendar.google.com/' });
  });

  document.getElementById('btnOpenFotmob').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.fotmob.com/' });
  });
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
