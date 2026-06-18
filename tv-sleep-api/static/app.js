const USER_LOCALE = navigator.language || 'en-US';
const API_TOKEN_STORAGE_KEY = 'drowseOffApiToken';
const THEME_STORAGE_KEY = 'drowseOffTheme';
const TAB_STORAGE_KEY = 'drowseOffTab';
const CHART_STORAGE_KEY = 'drowseOffChart';
const DEVICE_STORAGE_KEY = 'drowseOffDevice';

const yn = (value) => value ? '<span class="ok">YES</span>' : '<span class="bad">NO</span>';

const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[char]);

const formatTime = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString(USER_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const formatShortTime = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString(USER_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatClock = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString(USER_LOCALE, { hour: '2-digit', minute: '2-digit' });
};

const formatDuration = (seconds) => {
  const value = Number(seconds || 0);
  if (value < 60) return `${value}s`;

  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
};

const formatRemaining = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'expired';
  return `in ${formatDuration(seconds)}`;
};

const eventTypeLabel = (eventType) => {
  const labels = {
    tv_off_threshold_reached: 'TV OFF threshold reached',
    tv_off_esp32_manual: 'TV OFF sent from dashboard',
    tv_off_esp32_manual_failed: 'Dashboard TV OFF failed',
    tv_off_remote_auto: 'TV OFF via remote',
    tv_off_remote_manual: 'Dashboard TV OFF via remote',
    tv_off_remote_failed: 'Remote TV OFF failed',
    tv_off_esp32_auto: 'TV OFF via ESP32 IR',
    tv_off_skipped_tv_already_off: 'TV already off'
  };
  return labels[eventType] || eventType || '-';
};

const commandTypeLabel = (commandType) => {
  const labels = {
    tv_off: 'TV OFF'
  };
  return labels[commandType] || commandType || '-';
};

const commandStatusLabel = (status) => {
  const labels = {
    pending: 'Pending',
    claimed: 'Running',
    done: 'Done',
    failed: 'Failed',
    expired: 'Expired',
    cancelled: 'Cancelled'
  };
  return labels[status] || status || '-';
};

const commandStatusClass = (status) => {
  if (status === 'done') return 'ok';
  if (status === 'failed' || status === 'expired') return 'bad';
  if (status === 'pending' || status === 'claimed') return 'warn';
  return 'neutral';
};

const isDeviceOnline = (lastTs) => {
  if (!lastTs) return false;
  const date = new Date(lastTs);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < 90000;
};

const themeButtons = Array.from(document.querySelectorAll('[data-theme-option]'));
const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));
const chartModeButtons = Array.from(document.querySelectorAll('[data-chart-mode]'));
const deviceFilter = document.getElementById('deviceFilter');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const powerTvButton = document.getElementById('powerTvButton');
const powerRepeatButtons = Array.from(document.querySelectorAll('[data-power-repeat]'));
const exportLinks = Array.from(document.querySelectorAll('[data-export-url]'));
const apiTokenButton = document.getElementById('apiTokenButton');
const tokenGate = document.getElementById('tokenGate');
const tokenGateForm = document.getElementById('tokenGateForm');
const tokenGateInput = document.getElementById('tokenGateInput');
const tokenGateMessage = document.getElementById('tokenGateMessage');
const tokenGateClearButton = document.getElementById('tokenGateClearButton');
const dashboardLayout = document.getElementById('dashboardLayout');
const clearDataButton = document.getElementById('clearDataButton');
const settingsForm = document.getElementById('settingsForm');
const autoModeToggle = document.getElementById('autoModeToggle');
const autoModeLabel = document.getElementById('autoModeLabel');
const statusMessage = document.getElementById('statusMessage');
const chartCanvas = document.getElementById('sleepChart');
const chartCaption = document.getElementById('chartCaption');
const chartTitle = document.getElementById('chartTitle');
const calibrationStartButton = document.getElementById('calibrationStartButton');
const calibrationNextButton = document.getElementById('calibrationNextButton');
const calibrationApplyButton = document.getElementById('calibrationApplyButton');
const remoteLearnStartButton = document.getElementById('remoteLearnStartButton');
const remoteLearnCheckButton = document.getElementById('remoteLearnCheckButton');
const railPowerButton = document.getElementById('railPowerButton');
const railCalibrationButton = document.getElementById('railCalibrationButton');
const railDataButton = document.getElementById('railDataButton');

let latestSeries = [];
let latestSession = {};
let latestSettings = {};
let latestRemote = {};
let latestPower = {};
let latestCalibration = {};
let latestReadings = [];
let latestOnline = false;
let chartMode = 'score';
let selectedDeviceId = localStorage.getItem(DEVICE_STORAGE_KEY) || 'all';
let powerArmed = false;
let powerArmedTimer = null;
let clearArmed = false;
let clearArmedTimer = null;
let calibrationPhase = 'idle';
let calibrationTimer = null;
let calibrationSeconds = 0;

function currentThemePreference() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system';
}

function applyThemePreference(preference) {
  if (preference === 'system') {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    document.documentElement.dataset.theme = preference;
  }

  themeButtons.forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      button.dataset.themeOption === preference ? 'true' : 'false'
    );
  });

  setTimeout(() => renderSleepChart(latestSeries, latestSession.threshold), 0);
}

function setStatus(message) {
  statusMessage.textContent = message || '';
}

class ApiAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiAuthError';
  }
}

function apiToken() {
  return localStorage.getItem(API_TOKEN_STORAGE_KEY) || '';
}

function saveApiToken(token) {
  const nextToken = token.trim();

  if (nextToken) {
    localStorage.setItem(API_TOKEN_STORAGE_KEY, nextToken);
  } else {
    localStorage.removeItem(API_TOKEN_STORAGE_KEY);
  }
}

function authHeaders(headers = {}) {
  const token = apiToken();
  return token ? { ...headers, 'X-DrowseOff-Token': token } : headers;
}

function apiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  if (selectedDeviceId && selectedDeviceId !== 'all') {
    url.searchParams.set('device_id', selectedDeviceId);
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  return `${url.pathname}${url.search}`;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {})
  });

  if (response.status === 401) {
    const message = apiToken()
      ? 'The saved API token was rejected. Paste the current token to continue.'
      : 'Paste the API token for this DrowseOff server to load the dashboard.';
    throw new ApiAuthError(message);
  }

  return response;
}

async function apiJson(url, options = {}) {
  const response = await apiFetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `Request failed with status ${response.status}`);
  }

  return result;
}

function configureApiToken() {
  showTokenGate('Paste a new API token or clear the saved one from this browser.');
}

function showTokenGate(message) {
  tokenGate.hidden = false;
  dashboardLayout.hidden = true;
  tokenGateMessage.textContent = message || 'Paste the API token for this DrowseOff server. It is saved only in this browser.';
  tokenGateInput.value = '';
  setPill('topbarApiState', apiToken() ? 'token rejected' : 'token required', 'warn');
  setStatus('API authorization is required before loading dashboard data.');
  tokenGateInput.focus();
}

function hideTokenGate() {
  tokenGate.hidden = true;
  dashboardLayout.hidden = false;
}

function handleRefreshError(error, prefix = 'Dashboard refresh error') {
  if (error instanceof ApiAuthError) {
    showTokenGate(error.message);
    return;
  }

  setStatus(`${prefix}: ${error.message}`);
}

async function submitTokenGate(event) {
  event.preventDefault();
  const nextToken = tokenGateInput.value.trim();

  if (!nextToken) {
    tokenGateMessage.textContent = 'Paste a token before saving.';
    tokenGateInput.focus();
    return;
  }

  saveApiToken(nextToken);
  setStatus('API token saved in this browser. Loading dashboard...');

  try {
    await refresh();
  } catch (error) {
    handleRefreshError(error, 'Dashboard load error');
  }
}

function clearSavedToken() {
  saveApiToken('');
  showTokenGate('Saved token cleared. Paste the API token for this server to continue.');
}

function filenameFromResponse(response, fallback) {
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match ? match[1] : fallback;
}

async function downloadExport(event) {
  event.preventDefault();
  const link = event.currentTarget;
  const url = apiUrl(link.dataset.exportUrl || link.getAttribute('href'));
  setStatus('Preparing CSV export...');

  try {
    const response = await apiFetch(url);
    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = filenameFromResponse(response, link.getAttribute('download') || 'export.csv');
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus('CSV export ready.');
  } catch (error) {
    setStatus(`Export error: ${error.message}`);
  }
}

function selectTab(name) {
  if (!tabPanels.some((panel) => panel.dataset.tabPanel === name)) {
    name = 'overview';
  }

  tabButtons.forEach((button) => {
    const selected = button.dataset.tabTarget === name;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tabPanel === name);
  });

  localStorage.setItem(TAB_STORAGE_KEY, name);
  setTimeout(() => renderSleepChart(latestSeries, latestSession.threshold), 0);
}

function selectChartMode(mode) {
  chartMode = mode === 'distance' ? 'distance' : 'score';
  chartModeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.chartMode === chartMode ? 'true' : 'false');
  });
  renderSleepChart(latestSeries, latestSession.threshold);
}

function updateExportLinks() {
  exportLinks.forEach((link) => {
    const baseUrl = link.dataset.exportUrl || link.getAttribute('href');
    link.href = apiUrl(baseUrl);
  });
}

function renderDeviceFilter(payload) {
  const devices = Array.isArray(payload?.devices) ? payload.devices : [];
  const options = ['all', ...devices.filter((device) => device && device !== 'all')];

  if (!options.includes(selectedDeviceId)) {
    selectedDeviceId = 'all';
    localStorage.removeItem(DEVICE_STORAGE_KEY);
  }

  deviceFilter.innerHTML = options.map((device) => `
    <option value="${safe(device)}">${device === 'all' ? 'All devices' : safe(device)}</option>
  `).join('');
  deviceFilter.value = selectedDeviceId;
  updateExportLinks();
}

async function selectDevice() {
  selectedDeviceId = deviceFilter.value || 'all';
  if (selectedDeviceId === 'all') {
    localStorage.removeItem(DEVICE_STORAGE_KEY);
  } else {
    localStorage.setItem(DEVICE_STORAGE_KEY, selectedDeviceId);
  }

  setStatus(`Loading ${selectedDeviceId === 'all' ? 'all devices' : selectedDeviceId}...`);
  await refresh();
  setStatus('');
}

function selectedDevicePayload() {
  return selectedDeviceId && selectedDeviceId !== 'all'
    ? { device_id: selectedDeviceId }
    : {};
}

function resetClearButton() {
  clearArmed = false;
  clearDataButton.disabled = false;
  clearDataButton.textContent = 'Clear all data';

  if (clearArmedTimer) {
    clearTimeout(clearArmedTimer);
    clearArmedTimer = null;
  }
}

function resetPowerButton() {
  powerArmed = false;
  powerTvButton.textContent = 'Turn TV off';
  railPowerButton.textContent = 'Send TV OFF';
  setRemoteAvailability(latestOnline);

  if (powerArmedTimer) {
    clearTimeout(powerArmedTimer);
    powerArmedTimer = null;
  }
}

function setRemoteAvailability(online) {
  latestOnline = online;
  const remoteReady = Boolean(latestRemote.ready);
  const disabled = !online && !remoteReady;
  powerTvButton.disabled = disabled;
  railPowerButton.disabled = disabled;
  powerRepeatButtons.forEach((button) => {
    button.disabled = disabled;
  });

  document.getElementById('powerControlStatus').textContent = remoteReady
    ? 'Remote ready'
    : (online ? 'ESP32 fallback available' : 'Remote offline');
}

async function queuePowerCommand(repeatCount = 1) {
  if (latestRemote.ready) {
    const response = await apiFetch('/api/remote/send-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...selectedDevicePayload(),
        repeat_count: repeatCount,
        source: 'dashboard'
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'The remote did not send the command');
    }

    return result;
  }

  if (!latestOnline) {
    throw new Error('ESP32 is offline: command was not queued');
  }

  const response = await apiFetch('/api/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command_type: 'tv_off',
      ...selectedDevicePayload(),
      repeat_count: repeatCount,
      source: 'dashboard',
      note: `Requested from dashboard x${repeatCount}`
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Command was not queued');
  }

  return result;
}

async function sendPowerCommand() {
  if (!latestOnline && !latestRemote.ready) {
    setStatus('No remote is configured: ESP32 is offline and the remote hub is not configured.');
    return;
  }

  if (!powerArmed) {
    powerArmed = true;
    powerTvButton.textContent = 'Confirm TV OFF';
    railPowerButton.textContent = 'Confirm TV OFF';
    setStatus('Press again to send the TV OFF command.');

    powerArmedTimer = setTimeout(() => {
      resetPowerButton();
      setStatus('');
    }, 10000);
    return;
  }

  powerTvButton.disabled = true;
  const usingRemoteBackend = Boolean(latestRemote.ready);
  setStatus(usingRemoteBackend ? 'Sending TV OFF through the remote...' : 'Queueing TV OFF for the ESP32...');

  try {
    const result = await queuePowerCommand(1);
    await refresh();
    setStatus(usingRemoteBackend
      ? `TV OFF sent through the remote (#${result.id}).`
      : `TV OFF queued (#${result.id}). The ESP32 will pick it up on its next check.`);
  } catch (error) {
    setStatus(`TV OFF error: ${error.message}`);
  } finally {
    resetPowerButton();
  }
}

async function sendPowerTest(repeatCount) {
  setStatus(latestRemote.ready
    ? `Sending remote OFF test x${repeatCount}...`
    : `Queueing ESP32 OFF test x${repeatCount}...`);

  try {
    const result = await queuePowerCommand(repeatCount);
    await refresh();
    setStatus(latestRemote.ready
      ? `Remote OFF test x${repeatCount} sent (#${result.id}).`
      : `ESP32 OFF test x${repeatCount} queued (#${result.id}).`);
  } catch (error) {
    setStatus(`TV OFF test error: ${error.message}`);
  }
}

async function cancelPendingCommand(commandId) {
  setStatus(`Cancelling command #${commandId}...`);

  try {
    const response = await apiFetch('/api/commands/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Command was not cancelled');
    }

    await refresh();
    setStatus(`Command #${commandId} cancelled.`);
  } catch (error) {
    setStatus(`Cancel error: ${error.message}`);
  }
}

async function clearData() {
  if (!clearArmed) {
    clearArmed = true;
    clearDataButton.textContent = 'Confirm clear';
    setStatus('Press again to delete all saved readings, events, and commands.');

    clearArmedTimer = setTimeout(() => {
      resetClearButton();
      setStatus('');
    }, 10000);
    return;
  }

  clearDataButton.disabled = true;
  setStatus('Clearing data...');

  try {
    const response = await apiFetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'CLEAR' })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Clear operation failed');
    }

    await refresh();
    setStatus(`Clear complete: ${result.readings_deleted} readings, ${result.events_deleted} events, and ${result.commands_deleted} commands deleted.`);
  } catch (error) {
    setStatus(`Clear error: ${error.message}`);
  } finally {
    resetClearButton();
  }
}

function metricCard(label, value, detail = '') {
  return `
    <div class="card">
      <div class="label">${safe(label)}</div>
      <div class="value">${safe(value)}</div>
      ${detail ? `<div class="metric-detail">${safe(detail)}</div>` : ''}
    </div>
  `;
}

function renderHero(summary, session, settings) {
  const threshold = Number(session.threshold || settings.sleep_threshold || 0);
  const score = Number(session.max_sleep_score || summary.max_sleep_score || 0);
  const powerEvent = session.session_power_event;
  const autoOn = Number(settings.auto_power_enabled ?? 1) === 1;
  const progress = threshold > 0 ? Math.min(100, Math.round((score / threshold) * 100)) : 0;

  const badge = document.getElementById('verdictBadge');
  const title = document.getElementById('verdictTitle');
  const detail = document.getElementById('verdictDetail');
  const autoModePill = document.getElementById('autoModePill');

  badge.className = 'status-pill neutral';
  autoModePill.className = autoOn ? 'status-pill ok' : 'status-pill warn';
  autoModePill.textContent = autoOn ? 'Auto on' : 'Monitor only';

  if (!session.readings) {
    badge.textContent = 'Waiting';
    title.className = 'neutral';
    title.textContent = 'Waiting';
    detail.textContent = 'No readable session yet.';
  } else if (powerEvent) {
    badge.className = 'status-pill ok';
    badge.textContent = 'Confirmed';
    title.className = 'ok';
    title.textContent = 'TV OFF confirmed';
    detail.textContent = `Sent at ${formatClock(powerEvent.ts)} with score ${powerEvent.sleep_score ?? '-'}.`;
  } else if (score >= threshold && threshold > 0 && !autoOn) {
    badge.className = 'status-pill warn';
    badge.textContent = 'Monitor';
    title.className = 'warn';
    title.textContent = 'Threshold reached';
    detail.textContent = `${score}/${threshold}; automatic TV OFF is disabled.`;
  } else if (score >= threshold && threshold > 0) {
    badge.className = 'status-pill warn';
    badge.textContent = 'Review';
    title.className = 'warn';
    title.textContent = 'Action needed';
    detail.textContent = 'Threshold reached without a confirmed TV OFF event.';
  } else {
    badge.textContent = 'Monitoring';
    title.className = 'ok';
    title.textContent = 'Normal';
    detail.textContent = `Max score ${score}/${threshold || '-'}; no TV OFF needed.`;
  }

  document.getElementById('scoreProgressFill').style.width = `${progress}%`;
  document.getElementById('scoreProgressLabel').textContent = `${score}/${threshold || '-'}`;
  document.getElementById('deviceState').innerHTML = latestOnline
    ? '<span class="ok">Online</span>'
    : '<span class="bad">Offline</span>';
  document.getElementById('lastSeenLabel').textContent = formatTime(summary.last_ts);
  document.getElementById('pendingCommandsLabel').textContent = summary.pending_commands || 0;
}

function renderSummaryCards(summary, session, settings) {
  document.getElementById('cards').innerHTML = [
    metricCard('Total readings', summary.readings || 0, 'Local database'),
    metricCard('Latest reading', formatTime(summary.last_ts), latestOnline ? 'ESP32 online' : 'ESP32 offline'),
    metricCard('Max score', session.max_sleep_score || summary.max_sleep_score || 0, `Threshold ${session.threshold || settings.sleep_threshold || '-'}`),
    metricCard('TV commands', summary.tv_commands || 0, 'Successful events'),
    metricCard('Pending commands', summary.pending_commands || 0, 'Expire automatically'),
    metricCard('Mode', Number(settings.auto_power_enabled ?? 1) === 1 ? 'Auto' : 'Monitor', 'Config read by ESP32')
  ].join('');
}

function renderSessionCards(session) {
  latestSession = session || {};
  const powerEvent = latestSession.session_power_event;
  const powerDetail = powerEvent
    ? `Score ${powerEvent.sleep_score ?? '-'}`
    : 'No event recorded';

  document.getElementById('sessionWindow').textContent =
    `${formatShortTime(latestSession.window_start)} - ${formatShortTime(latestSession.window_end)}`;

  document.getElementById('sessionCards').innerHTML = [
    metricCard('Session readings', latestSession.readings || 0, latestSession.session_active ? 'Active session' : 'Closed session'),
    metricCard('First in bed', formatTime(latestSession.first_in_bed_ts), `In bed ${formatDuration(latestSession.in_bed_seconds)}`),
    metricCard('Stable time', formatDuration(latestSession.stable_seconds), `${latestSession.out_of_bed_readings || 0} out-of-bed readings`),
    metricCard('Max score', latestSession.max_sleep_score || 0, `Threshold ${latestSession.threshold ?? '-'}`),
    metricCard('Session TV OFF', powerEvent ? formatTime(powerEvent.ts) : 'Never', powerDetail),
    metricCard('Firmware mode', latestSession.mode || '-', 'From latest ESP32 reading')
  ].join('');
}

function renderSessionSummary(report) {
  document.getElementById('sessionSummaryWindow').textContent =
    `${formatShortTime(report.window_start)} - ${formatShortTime(report.window_end)}`;
  document.getElementById('sessionSummary').textContent = report.summary || '-';
  document.getElementById('sessionMetrics').innerHTML = [
    ['In bed', formatDuration(report.in_bed_seconds)],
    ['Stable', formatDuration(report.stable_seconds)],
    ['Max score', report.max_sleep_score ?? 0],
    ['TV commands', report.tv_commands ?? 0]
  ].map(([label, value]) => `
    <div class="mini-metric">
      <span>${safe(label)}</span>
      <strong>${safe(value)}</strong>
    </div>
  `).join('');
}

function renderScoreReason(readings) {
  const latest = readings.find((row) => row.score_reason) || readings[0];

  if (!latest) {
    document.getElementById('scoreReasonText').textContent = 'No reading available.';
    document.getElementById('latestReasonMetrics').innerHTML = '';
    return;
  }

  document.getElementById('scoreReasonText').textContent =
    latest.score_reason || 'The current firmware has not sent a score reason yet.';
  document.getElementById('latestReasonMetrics').innerHTML = [
    ['Time', formatClock(latest.ts)],
    ['Score', latest.sleep_score ?? '-'],
    ['Distance', latest.dist_filtered ? `${latest.dist_filtered} cm` : '-'],
    ['Stable', latest.stable ? 'YES' : 'NO']
  ].map(([label, value]) => `
    <div class="mini-metric">
      <span>${safe(label)}</span>
      <strong>${safe(value)}</strong>
    </div>
  `).join('');
}

function settingInput(name) {
  return settingsForm.elements[name];
}

function renderSettings(settings) {
  latestSettings = settings || {};
  Object.entries(latestSettings).forEach(([key, value]) => {
    const input = settingInput(key);
    if (input && document.activeElement !== input) {
      input.value = value ?? '';
    }
  });

  const autoOn = Number(latestSettings.auto_power_enabled ?? 1) === 1;
  autoModeToggle.checked = autoOn;
  autoModeLabel.textContent = autoOn ? 'Auto' : 'Monitor';
  document.getElementById('autoModeSidebar').textContent = autoOn ? 'auto' : 'monitor';

  document.getElementById('settingsUpdated').textContent =
    latestSettings.updated_at ? `Updated ${formatTime(latestSettings.updated_at)}` : 'Default values';
}

function renderRemoteStatus(status) {
  latestRemote = status || {};
  const statusLabel = document.getElementById('remoteBackendStatus');
  const detail = document.getElementById('remoteBackendDetail');
  const provider = latestRemote.provider || 'remote';
  const host = latestRemote.host || '';
  const probeDetail = latestRemote.last_probe_at
    ? `last probe ${formatTime(latestRemote.last_probe_at)}`
    : 'not probed yet';
  const remoteKnownDown = Boolean(host && latestRemote.connected === false && latestRemote.last_probe_error);

  if (!latestRemote.library_ready) {
    statusLabel.innerHTML = '<span class="bad">Library missing</span>';
    detail.textContent = latestRemote.library_error || 'Remote backend is not available.';
  } else if (latestRemote.ready) {
    statusLabel.innerHTML = '<span class="ok">Ready</span>';
    detail.textContent = `${provider} ${host} - reachable, OFF code saved (${probeDetail})`;
  } else if (remoteKnownDown) {
    statusLabel.innerHTML = '<span class="bad">Unreachable</span>';
    detail.textContent = latestRemote.last_probe_error || `${provider} ${host} did not respond`;
  } else if (latestRemote.host) {
    statusLabel.innerHTML = '<span class="warn">Needs learning</span>';
    detail.textContent = `${provider} ${host} - OFF code not saved (${probeDetail})`;
  } else {
    statusLabel.innerHTML = '<span class="bad">Not configured</span>';
    detail.textContent = 'Remote host is missing.';
  }
}

function renderPowerStatus(power) {
  latestPower = power || {};
  const detail = document.getElementById('componentPowerDetail');

  if (!detail) return;

  if (!latestPower.configured) {
    detail.textContent = 'power meter not configured';
    setPill('componentPowerState', 'none', 'neutral');
    return;
  }

  if (!latestPower.ready) {
    detail.textContent = latestPower.last_probe_error || 'power meter unreachable';
    setPill('componentPowerState', 'down', 'bad');
    return;
  }

  const watts = Number(latestPower.apower_w ?? 0).toFixed(1);
  const threshold = Number(latestPower.on_threshold_w ?? 0).toFixed(0);
  detail.textContent = `${latestPower.provider || 'meter'} ${latestPower.host} - ${watts} W, threshold ${threshold} W`;
  setPill(
    'componentPowerState',
    latestPower.tv_on ? 'on' : 'off',
    latestPower.tv_on ? 'warn' : 'ok'
  );
}

function setPill(id, label, state = 'neutral') {
  const element = document.getElementById(id);
  if (!element) return;
  element.className = `status-pill ${state}`;
  element.textContent = label;
}

function renderOperationsRail(summary, settings, remote, session) {
  const autoOn = Number(settings.auto_power_enabled ?? 1) === 1;
  const sensorDetail = latestOnline
    ? `last seen ${formatTime(summary.last_ts)}`
    : 'no recent reading';
  const remoteReady = Boolean(remote.ready);
  const remoteConfigured = Boolean(remote.configured);
  const remoteConnected = remote.connected === true;
  const remoteKnownDown = Boolean(remote.host && remote.connected === false && remote.last_probe_error);
  const powerEvent = session.session_power_event;
  const threshold = Number(session.threshold || settings.sleep_threshold || 0);
  const score = Number(session.max_sleep_score || summary.max_sleep_score || 0);
  const thresholdReached = threshold > 0 && score >= threshold;
  const powerReady = Boolean(latestPower.ready);
  const powerKnownDown = Boolean(latestPower.configured && !latestPower.ready);

  document.getElementById('componentSensorDetail').textContent = sensorDetail;
  document.getElementById('componentRemoteDetail').textContent = remote.host
    ? `${remote.provider || 'remote'} ${remote.host}`
    : 'host not configured';

  setPill('componentSensorState', latestOnline ? 'up' : 'down', latestOnline ? 'ok' : 'bad');
  if (remoteReady) {
    setPill('componentRemoteState', 'ready', 'ok');
  } else if (remoteConfigured && !remoteConnected) {
    setPill('componentRemoteState', 'down', 'bad');
  } else if (remoteKnownDown) {
    setPill('componentRemoteState', 'down', 'bad');
  } else if (remote.host) {
    setPill('componentRemoteState', 'learn', 'warn');
  } else {
    setPill('componentRemoteState', 'check', 'warn');
  }
  setPill('componentModeState', autoOn ? 'auto' : 'monitor', autoOn ? 'ok' : 'warn');
  setPill('topbarApiState', 'API local', 'ok');
  setPill('topbarRefreshState', 'refresh 10s', 'neutral');

  const alertBox = document.getElementById('opsAlertBox');
  const alertCount = document.getElementById('alertCountLabel');
  alertBox.className = 'alert-box';

  if (!latestOnline) {
    alertBox.classList.add('bad');
    alertBox.innerHTML = '<strong>Sensor offline</strong><p>No recent ESP32 reading. Check power, Wi-Fi, or API token configuration.</p>';
    alertCount.textContent = '1 grouped';
  } else if (powerKnownDown) {
    alertBox.classList.add('bad');
    alertBox.innerHTML = '<strong>Power meter unreachable</strong><p>The TV power meter is configured, but DrowseOff cannot read current wattage.</p>';
    alertCount.textContent = '1 grouped';
  } else if ((remoteConfigured && !remoteConnected) || remoteKnownDown) {
    alertBox.classList.add('bad');
    alertBox.innerHTML = '<strong>Remote unreachable</strong><p>The remote host is configured, but the latest probe failed. TV OFF may fall back to ESP32 IR or fail.</p>';
    alertCount.textContent = '1 grouped';
  } else if (!remoteReady) {
    alertBox.classList.add('warn');
    alertBox.innerHTML = '<strong>Remote not configured</strong><p>The dashboard can monitor sessions, but TV OFF may fall back to ESP32 IR or fail.</p>';
    alertCount.textContent = '1 grouped';
  } else if (thresholdReached && !powerEvent && autoOn) {
    alertBox.classList.add('warn');
    alertBox.innerHTML = '<strong>Threshold without confirmation</strong><p>The score reached the threshold, but no confirmed TV OFF event is attached to this session.</p>';
    alertCount.textContent = '1 grouped';
  } else {
    alertBox.innerHTML = powerReady
      ? '<strong>No active alerts</strong><p>Sensor, remote backend, TV power meter, and ingestion are operating normally.</p>'
      : '<strong>No active alerts</strong><p>Sensor, remote backend, and ingestion are operating normally.</p>';
    alertCount.textContent = '0 grouped';
  }
}

async function startRemoteLearning() {
  remoteLearnStartButton.disabled = true;
  setStatus('Remote learning mode is starting...');

  try {
    const response = await apiFetch('/api/remote/learn/start', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Learning mode did not start');
    }

    renderRemoteStatus(result);
    setStatus('Now send the TV OFF command toward the remote hub, then press Save OFF Code.');
  } catch (error) {
    setStatus(`Remote error: ${error.message}`);
  } finally {
    remoteLearnStartButton.disabled = false;
  }
}

async function checkRemoteLearning() {
  remoteLearnCheckButton.disabled = true;
  setStatus('Checking received OFF code...');

  try {
    const response = await apiFetch('/api/remote/learn/check', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'OFF code was not received');
    }

    renderRemoteStatus(result);
    await refresh();
    setStatus(`Remote OFF code saved (${result.bytes} bytes).`);
  } catch (error) {
    setStatus(`Remote learning error: ${error.message}`);
  } finally {
    remoteLearnCheckButton.disabled = false;
  }
}

async function postSettings(payload) {
  const response = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Settings were not saved');
  }

  renderSettings(result.settings);
  return result.settings;
}

async function saveSettings(event) {
  event.preventDefault();
  setStatus('Saving settings...');

  const payload = {};
  Array.from(settingsForm.elements).forEach((element) => {
    if (!element.name) return;
    payload[element.name] = Number(element.value);
  });
  payload.auto_power_enabled = autoModeToggle.checked ? 1 : 0;

  try {
    await postSettings(payload);
    await refresh();
    setStatus('Settings saved. The ESP32 will read them on its next check.');
  } catch (error) {
    setStatus(`Settings error: ${error.message}`);
  }
}

async function toggleAutoMode() {
  const enabled = autoModeToggle.checked ? 1 : 0;
  autoModeLabel.textContent = enabled ? 'Auto' : 'Monitor';
  setStatus(enabled ? 'Enabling automatic TV OFF...' : 'Switching to monitoring-only mode...');

  try {
    await postSettings({ auto_power_enabled: enabled });
    await refresh();
    setStatus(enabled ? 'Automatic TV OFF is active.' : 'Monitoring-only mode is active.');
  } catch (error) {
    autoModeToggle.checked = !autoModeToggle.checked;
    setStatus(`Mode error: ${error.message}`);
  }
}

function renderCalibration(calibration) {
  latestCalibration = calibration || {};
  document.getElementById('calibrationCards').innerHTML = [
    metricCard('Samples', calibration.samples || 0, `${calibration.in_bed_samples || 0} in bed`),
    metricCard('Median distance', calibration.distance_median_cm ?? '-', `p10 ${calibration.distance_p10_cm ?? '-'} / p90 ${calibration.distance_p90_cm ?? '-'}`),
    metricCard('Suggested range', `${calibration.suggested_min_cm ?? '-'}-${calibration.suggested_max_cm ?? '-'} cm`, `Current ${calibration.current_min_cm}-${calibration.current_max_cm} cm`),
    metricCard('Stability', `${Math.round((calibration.stable_rate || 0) * 100)}%`, `${calibration.stable_samples || 0} stable readings`)
  ].join('');

  calibrationApplyButton.disabled = !calibration.suggested_min_cm || !calibration.suggested_max_cm;
}

function updateCalibrationWizard() {
  const title = document.getElementById('calibrationStepTitle');
  const detail = document.getElementById('calibrationStepDetail');
  const timer = document.getElementById('calibrationTimer');

  timer.textContent = calibrationSeconds > 0 ? `${calibrationSeconds}s` : '--';

  if (calibrationPhase === 'idle') {
    title.textContent = 'Ready';
    detail.textContent = 'Lie in bed, then start the guided session. At the end you can apply the suggested range.';
    calibrationStartButton.disabled = false;
    calibrationNextButton.disabled = true;
  } else if (calibrationPhase === 'in_bed') {
    title.textContent = 'Stay in bed';
    detail.textContent = 'Breathe normally and stay as still as possible while the sensor collects readings.';
    calibrationStartButton.disabled = true;
    calibrationNextButton.disabled = true;
  } else if (calibrationPhase === 'out_bed_ready') {
    title.textContent = 'Now leave the bed';
    detail.textContent = 'Once you are out of bed, press the next step to check the out-of-range behavior.';
    calibrationStartButton.disabled = true;
    calibrationNextButton.disabled = false;
  } else if (calibrationPhase === 'out_bed') {
    title.textContent = 'Out of bed';
    detail.textContent = 'Stay out of bed for a few seconds. This helps detect whether the range is too wide.';
    calibrationStartButton.disabled = true;
    calibrationNextButton.disabled = true;
  } else if (calibrationPhase === 'done') {
    title.textContent = 'Calibration complete';
    detail.textContent = 'Review the suggested range and apply it if it matches the real sensor placement.';
    calibrationStartButton.disabled = false;
    calibrationNextButton.disabled = true;
  }
}

function runCalibrationCountdown(nextPhase, seconds) {
  calibrationSeconds = seconds;
  updateCalibrationWizard();

  if (calibrationTimer) {
    clearInterval(calibrationTimer);
  }

  calibrationTimer = setInterval(async () => {
    calibrationSeconds -= 1;
    updateCalibrationWizard();

    if (calibrationSeconds <= 0) {
      clearInterval(calibrationTimer);
      calibrationTimer = null;
      calibrationPhase = nextPhase;
      await refresh();
      updateCalibrationWizard();
    }
  }, 1000);
}

function startCalibrationWizard() {
  calibrationPhase = 'in_bed';
  setStatus('Calibration: stay in bed for 30 seconds.');
  runCalibrationCountdown('out_bed_ready', 30);
}

function nextCalibrationStep() {
  calibrationPhase = 'out_bed';
  setStatus('Calibration: stay out of bed for 20 seconds.');
  runCalibrationCountdown('done', 20);
}

async function applyCalibrationRange() {
  if (!latestCalibration.suggested_min_cm || !latestCalibration.suggested_max_cm) {
    setStatus('Suggested range is not available.');
    return;
  }

  setStatus('Applying suggested bed range...');
  try {
    await postSettings({
      distance_min_cm: latestCalibration.suggested_min_cm,
      distance_max_cm: latestCalibration.suggested_max_cm
    });
    await refresh();
    setStatus(`Bed range updated to ${latestCalibration.suggested_min_cm}-${latestCalibration.suggested_max_cm} cm.`);
  } catch (error) {
    setStatus(`Calibration error: ${error.message}`);
  }
}

function drawInBedBands(context, points, xFor, top, height, widthPerPoint, color) {
  context.fillStyle = color;
  points.forEach((point, index) => {
    if (!point.in_bed) return;
    context.fillRect(xFor(index) - widthPerPoint / 2, top, widthPerPoint, height);
  });
}

function renderSleepChart(points = [], threshold) {
  latestSeries = points;
  const context = chartCanvas.getContext('2d');
  const width = Math.max(chartCanvas.clientWidth || 640, 280);
  const height = 240;
  const dpr = window.devicePixelRatio || 1;
  chartCanvas.width = Math.floor(width * dpr);
  chartCanvas.height = Math.floor(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const text = styles.getPropertyValue('--text').trim();
  const muted = styles.getPropertyValue('--muted').trim();
  const border = styles.getPropertyValue('--border').trim();
  const accent = styles.getPropertyValue('--accent').trim();
  const bad = styles.getPropertyValue('--bad').trim();
  const warn = styles.getPropertyValue('--warn').trim();

  if (!points.length) {
    chartCaption.textContent = 'No data in the recent session';
    chartTitle.textContent = chartMode === 'distance' ? 'Filtered distance' : 'Sleep score';
    context.fillStyle = muted;
    context.font = '13px system-ui, sans-serif';
    context.fillText('No data to show', 16, 36);
    return;
  }

  chartCaption.textContent =
    `${formatShortTime(points[0].ts)} - ${formatShortTime(points[points.length - 1].ts)}`;
  chartTitle.textContent = chartMode === 'distance' ? 'Filtered distance' : 'Sleep score';

  const padding = { top: 18, right: 18, bottom: 30, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xFor = (index) => padding.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const widthPerPoint = Math.max(2, plotWidth / Math.max(1, points.length - 1));

  let values;
  let yMin;
  let yMax;
  let guideLines = [];

  if (chartMode === 'distance') {
    values = points.map((point) => Number(point.dist_filtered || point.dist_raw || 0)).filter(Boolean);
    const minSetting = Number(latestSettings.distance_min_cm || 0);
    const maxSetting = Number(latestSettings.distance_max_cm || 0);
    yMin = Math.max(0, Math.min(...values, minSetting || Infinity) - 10);
    yMax = Math.max(...values, maxSetting || 0, yMin + 10) + 10;
    guideLines = [
      { value: minSetting, label: 'Bed min', color: warn },
      { value: maxSetting, label: 'Bed max', color: warn }
    ].filter((line) => line.value > 0);
  } else {
    values = points.map((point) => Number(point.sleep_score || 0));
    const thresholdValue = Number(threshold || points.find((point) => point.threshold)?.threshold || 0);
    yMin = 0;
    yMax = Math.ceil(Math.max(...values, thresholdValue, 10) / 10) * 10;
    guideLines = thresholdValue > 0 ? [{ value: thresholdValue, label: 'Threshold', color: bad }] : [];
  }

  const yFor = (value) => padding.top + (1 - ((value - yMin) / Math.max(1, yMax - yMin))) * plotHeight;

  drawInBedBands(
    context,
    points,
    xFor,
    padding.top,
    plotHeight,
    widthPerPoint,
    colorMix(accent, 0.12)
  );

  context.strokeStyle = border;
  context.lineWidth = 1;
  context.fillStyle = muted;
  context.font = '12px system-ui, sans-serif';

  [yMin, Math.round((yMin + yMax) / 2), yMax].forEach((tick) => {
    const y = yFor(tick);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(tick), 8, y + 4);
  });

  guideLines.forEach((line) => {
    const y = yFor(line.value);
    context.save();
    context.setLineDash([5, 5]);
    context.strokeStyle = line.color;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.restore();
    context.fillStyle = line.color;
    context.fillText(line.label, width - padding.right - 62, y - 6);
  });

  context.strokeStyle = chartMode === 'distance' ? warn : accent;
  context.lineWidth = 2.5;
  context.beginPath();
  let hasPoint = false;

  points.forEach((point, index) => {
    const rawValue = chartMode === 'distance'
      ? Number(point.dist_filtered || point.dist_raw || 0)
      : Number(point.sleep_score || 0);

    if (!rawValue && chartMode === 'distance') return;

    const x = xFor(index);
    const y = yFor(rawValue);
    if (!hasPoint) {
      context.moveTo(x, y);
      hasPoint = true;
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();

  points.forEach((point, index) => {
    if (!point.tv_command_sent) return;
    const value = chartMode === 'distance'
      ? Number(point.dist_filtered || point.dist_raw || yMin)
      : Number(point.sleep_score || 0);
    context.fillStyle = bad;
    context.beginPath();
    context.arc(xFor(index), yFor(value), 4, 0, Math.PI * 2);
    context.fill();
  });

  context.fillStyle = text;
  context.font = '12px system-ui, sans-serif';
  context.fillText(formatShortTime(points[0].ts), padding.left, height - 8);
  context.fillText(
    formatShortTime(points[points.length - 1].ts),
    Math.max(padding.left, width - padding.right - 86),
    height - 8
  );
}

function colorMix(color, alpha) {
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgb(${r} ${g} ${b} / ${alpha})`;
  }
  return `rgb(47 101 200 / ${alpha})`;
}

function renderEvents(events) {
  const eventRows = document.getElementById('eventRows');

  if (!events.length) {
    eventRows.innerHTML = `
      <tr>
        <td class="empty-row" colspan="5">No events recorded.</td>
      </tr>
    `;
    return;
  }

  eventRows.innerHTML = events.map((event) => `
    <tr>
      <td>${formatTime(event.ts)}</td>
      <td>${safe(eventTypeLabel(event.event_type))}</td>
      <td>${event.sleep_score ?? ''}</td>
      <td>${event.dist_filtered ?? ''}</td>
      <td>${safe(event.note || '')}</td>
    </tr>
  `).join('');
}

function renderCommands(commands) {
  const commandRows = document.getElementById('commandRows');

  if (!commands.length) {
    commandRows.innerHTML = `
      <tr>
        <td class="empty-row" colspan="5">No manual commands recorded.</td>
      </tr>
    `;
    return;
  }

  commandRows.innerHTML = commands.map((command) => `
    <tr>
      <td>${formatTime(command.created_at)}</td>
      <td>${safe(commandTypeLabel(command.command_type))} x${command.repeat_count || 1}</td>
      <td><span class="status-label ${commandStatusClass(command.status)}">${safe(commandStatusLabel(command.status))}</span></td>
      <td>${command.status === 'pending' ? safe(formatRemaining(command.expires_at)) : formatTime(command.completed_at)}</td>
      <td>
        ${command.status === 'pending'
          ? `<button class="small-button" type="button" data-cancel-command="${command.id}">Cancel</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

function renderReadings(readings) {
  const rows = document.getElementById('rows');

  if (!readings.length) {
    rows.innerHTML = `
      <tr>
        <td class="empty-row" colspan="9">No readings recorded.</td>
      </tr>
    `;
    return;
  }

  rows.innerHTML = readings.map((row) => `
    <tr>
      <td>${formatTime(row.ts)}</td>
      <td>${yn(row.radar_ok)}</td>
      <td>${yn(row.in_bed)}</td>
      <td>${yn(row.stable)}</td>
      <td>${row.dist_raw ?? ''}</td>
      <td>${row.dist_filtered ?? ''}</td>
      <td>${row.sleep_score ?? ''}</td>
      <td>${safe(row.score_reason || '')}</td>
      <td>${row.tv_command_sent ? 'OFF' : ''}</td>
    </tr>
  `).join('');
}

async function refresh() {
  const devices = await apiJson('/api/devices');
  renderDeviceFilter(devices);

  const [summary, settings, remote, power, sessionSummary, calibration, session, series, events, commands, readings] = await Promise.all([
    apiJson(apiUrl('/api/summary')),
    apiJson('/api/settings'),
    apiJson('/api/remote/status'),
    apiJson('/api/power/status'),
    apiJson(apiUrl('/api/session-summary')),
    apiJson(apiUrl('/api/calibration')),
    apiJson(apiUrl('/api/session')),
    apiJson(apiUrl('/api/sleep-series')),
    apiJson(apiUrl('/api/events', { limit: 20 })),
    apiJson(apiUrl('/api/commands', { limit: 20 })),
    apiJson(apiUrl('/api/readings', { limit: 80 }))
  ]);

  latestOnline = isDeviceOnline(summary.last_ts);
  latestReadings = readings;

  renderSettings(settings);
  renderRemoteStatus(remote);
  renderPowerStatus(power);
  renderHero(summary, session, settings);
  renderSummaryCards(summary, session, settings);
  renderSessionSummary(sessionSummary);
  renderScoreReason(readings);
  renderSessionCards(session);
  renderCalibration(calibration);
  renderSleepChart(series.points || [], session.threshold);
  renderEvents(events);
  renderCommands(commands);
  renderReadings(readings);
  setRemoteAvailability(latestOnline);
  renderOperationsRail(summary, settings, remote, session);
  const wasAuthBlocked = !tokenGate.hidden;
  hideTokenGate();
  if (wasAuthBlocked) {
    setStatus('');
  }
}

themeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    applyThemePreference(button.dataset.themeOption);
  });
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectTab(button.dataset.tabTarget);
  });
});

chartModeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectChartMode(button.dataset.chartMode);
  });
});

deviceFilter.addEventListener('change', () => {
  selectDevice().catch((error) => {
    handleRefreshError(error, 'Device filter error');
  });
});

systemTheme.addEventListener('change', () => {
  if (currentThemePreference() === 'system') {
    applyThemePreference('system');
  }
});

apiTokenButton.addEventListener('click', configureApiToken);
tokenGateForm.addEventListener('submit', submitTokenGate);
tokenGateClearButton.addEventListener('click', clearSavedToken);
exportLinks.forEach((link) => {
  link.addEventListener('click', downloadExport);
});
powerTvButton.addEventListener('click', sendPowerCommand);
railPowerButton.addEventListener('click', sendPowerCommand);
railCalibrationButton.addEventListener('click', () => selectTab('calibration'));
railDataButton.addEventListener('click', () => selectTab('data'));
powerRepeatButtons.forEach((button) => {
  button.addEventListener('click', () => {
    sendPowerTest(Number(button.dataset.powerRepeat || 1));
  });
});
settingsForm.addEventListener('submit', saveSettings);
autoModeToggle.addEventListener('change', toggleAutoMode);
clearDataButton.addEventListener('click', clearData);
calibrationStartButton.addEventListener('click', startCalibrationWizard);
calibrationNextButton.addEventListener('click', nextCalibrationStep);
calibrationApplyButton.addEventListener('click', applyCalibrationRange);
remoteLearnStartButton.addEventListener('click', startRemoteLearning);
remoteLearnCheckButton.addEventListener('click', checkRemoteLearning);
document.getElementById('commandRows').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cancel-command]');
  if (!button) return;
  cancelPendingCommand(Number(button.dataset.cancelCommand));
});
window.addEventListener('resize', () => renderSleepChart(latestSeries, latestSession.threshold));

applyThemePreference(currentThemePreference());
selectTab(
  localStorage.getItem(TAB_STORAGE_KEY) || 'overview'
);
selectChartMode(
  localStorage.getItem(CHART_STORAGE_KEY) || 'score'
);
chartModeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    localStorage.setItem(CHART_STORAGE_KEY, chartMode);
  });
});
updateCalibrationWizard();
refresh().catch((error) => {
  handleRefreshError(error, 'Dashboard load error');
});
setInterval(() => {
  if (!tokenGate.hidden) {
    return;
  }

  refresh().catch((error) => {
    handleRefreshError(error, 'Dashboard refresh error');
  });
}, 10000);
