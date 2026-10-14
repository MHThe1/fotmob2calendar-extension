# ⚽ FotMob to Google Calendar (1-Click Sync)

A Chrome Extension (Manifest V3) that adds and removes football matches from **FotMob** to your **Google Calendar** with **1-click**.

---

## ✨ Features

- **⚡ True 1-Click Sync**: Add or remove any match directly from FotMob without leaving the page.
- **📅 Works Everywhere on FotMob**:
  - **Match Details View**: Sleek `[ Add to Calendar ]` action button in the match header.
  - **Fixtures & League Schedules**: Compact calendar icon on every match card/row across daily fixtures, league tables, and team calendars.
- **🔄 Instant 1-Click Removal**: Once added, the button shows `[ ✓ In Calendar ]` (and turns into `[ ✕ Remove ]` on hover) to instantly delete the event from Google Calendar.
- **🎯 Calendar Selector**: Choose which Google Calendar (Primary, or a custom "⚽ Football" calendar) matches are saved to.
- **🔔 Custom Kickoff Reminders**: Set default notifications (e.g., 15 minutes before, 1 hour before) via browser popup notifications or email.
- **🎨 Color Palette**: Tag your soccer events with any of Google Calendar's 11 official colors (Basil Green, Peacock Blue, Flamingo Coral, etc.).
- **⏱️ Configurable Duration**: Default match duration (e.g., 115 minutes to cover 90 mins + halftime + stoppage time).
- **🏷️ Customizable Title Template**: Format event titles using tags like `⚽ {home} vs {away} ({league})`.
- **📋 Synced Matches History**: View, search, and manage all scheduled matches in the Options page or popup widget.
- **🔗 Rich Details**: Automatically includes kickoff time, competition, stage, stadium/venue, and deep link to the FotMob match page.

---

## 🚀 How to Install in Chrome

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. In the top right corner, toggle on **Developer mode**.
3. Click **Load unpacked** (top left).
4. Select this directory:
   ```text
   f:\Programming\fotmob2Calender
   ```
5. The extension icon (⚽ inside a calendar) will appear in your Chrome toolbar!

---

## 🔑 3-Minute Google OAuth Setup

Google strictly requires OAuth 2.0 to silently create and delete calendar events. Setup takes under 3 minutes:

1. Go to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Create a project (e.g., *FotMob Calendar Sync*).
3. In the search bar, search for **Google Calendar API** and click **Enable**.
4. Go to **OAuth consent screen**:
   - User Type: **External** -> click *Create*.
   - Fill in App name (*FotMob2Cal*) and your user support email.
   - Under **Scopes**, click *Add or Remove Scopes* and select `.../auth/calendar.events` and `.../auth/calendar.readonly`.
   - Under **Test users**, add your own Google email address.
5. Go to **Credentials** -> **Create Credentials** -> **OAuth client ID**:
   - Application type: **Web application**.
   - Name: *FotMob Chrome Extension*.
   - In **Authorized redirect URIs**, paste this exact URI:
     ```text
     https://bebibnckeidijgchhcejbedinldcmfnn.chromiumapp.org/
     ```
6. Click **Create** and copy your **Client ID** (it looks like `123456789-abcdefg.apps.googleusercontent.com`).
7. Open the extension **Settings** (right-click extension icon > *Options* or click *Settings* in popup):
   - Paste your **Client ID** into the input box and click **Save ID**.
   - Click **Connect Google Account** and approve the permissions.
8. That's it! You're ready to 1-click sync any match on FotMob.

---

## 📌 Usage Guide

1. Navigate to [fotmob.com](https://www.fotmob.com).
2. **From Fixture Lists**:
   - You will see a small green calendar icon next to each upcoming match.
   - Click it once: the match is added to your Google Calendar in the background, and the icon turns into a checkmark!
   - Click it again: the match is removed from Google Calendar.
3. **From Single Match View**:
   - Click into any match details page (e.g. `/matches/...` or `/match/...`).
   - A `[ Add to Calendar ]` button will appear in the match header.
   - Click it to schedule. Once added, it displays `[ In Calendar ]` with 1-click remove on hover.
4. **Extension Popup**:
   - Click the extension icon in your Chrome toolbar to check your connected calendar, view upcoming synced matches, or remove them with 1 click.

---

## ⚙️ Options & Customization

Open Extension Options to customize:
- **Target Calendar**: Choose between Primary or any secondary calendar.
- **Match Duration**: 90 to 180 minutes slider (default: 115m).
- **Reminders**: Add multiple reminders (e.g. 15m before, 1h before).
- **Event Colors**: Pick from 11 Google Calendar color themes with live preview.
- **Title Format**: Configure template using `{home}`, `{away}`, `{league}`, `{round}`.
- **Location & Links**: Toggle venue and FotMob match URLs.
