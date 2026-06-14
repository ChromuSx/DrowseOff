const yn = (value) => value ? '<span class="ok">SI</span>' : '<span class="bad">NO</span>';

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
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('it-IT', {
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
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('it-IT', {
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
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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
  if (seconds <= 0) return 'scaduto';
  return `tra ${formatDuration(seconds)}`;
};

const eventTypeLabel = (eventType) => {
  const labels = {
    tv_power_off_attempt: 'Tentativo spegnimento TV',
    tv_power_manual: 'Spegnimento TV inviato da dashboard',
    tv_power_manual_failed: 'Spegnimento TV dashboard fallito',
    tv_power_broadlink_auto: 'Spegnimento TV via BroadLink',
    tv_power_broadlink_manual: 'Spegnimento TV BroadLink dashboard',
    tv_power_broadlink_failed: 'BroadLink fallito'
  };
  return labels[eventType] || eventType || '-';
};

const commandTypeLabel = (commandType) => {
  const labels = {
    tv_power: 'Spegni TV'
  };
  return labels[commandType] || commandType || '-';
};

const commandStatusLabel = (status) => {
  const labels = {
    pending: 'In attesa',
    claimed: 'In esecuzione',
    done: 'Completato',
    failed: 'Fallito',
    expired: 'Scaduto',
    cancelled: 'Annullato'
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
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const powerTvButton = document.getElementById('powerTvButton');
const powerRepeatButtons = Array.from(document.querySelectorAll('[data-power-repeat]'));
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
const broadlinkLearnStartButton = document.getElementById('broadlinkLearnStartButton');
const broadlinkLearnCheckButton = document.getElementById('broadlinkLearnCheckButton');

let latestSeries = [];
let latestSession = {};
let latestSettings = {};
let latestBroadlink = {};
let latestCalibration = {};
let latestReadings = [];
let latestOnline = false;
let chartMode = 'score';
let powerArmed = false;
let powerArmedTimer = null;
let clearArmed = false;
let clearArmedTimer = null;
let calibrationPhase = 'idle';
let calibrationTimer = null;
let calibrationSeconds = 0;

function currentThemePreference() {
  const savedTheme = localStorage.getItem('tvSleepTheme');
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system';
}

function applyThemePreference(preference) {
  if (preference === 'system') {
    localStorage.removeItem('tvSleepTheme');
    document.documentElement.removeAttribute('data-theme');
  } else {
    localStorage.setItem('tvSleepTheme', preference);
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

  localStorage.setItem('tvSleepTab', name);
  setTimeout(() => renderSleepChart(latestSeries, latestSession.threshold), 0);
}

function selectChartMode(mode) {
  chartMode = mode === 'distance' ? 'distance' : 'score';
  chartModeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.chartMode === chartMode ? 'true' : 'false');
  });
  renderSleepChart(latestSeries, latestSession.threshold);
}

function resetClearButton() {
  clearArmed = false;
  clearDataButton.disabled = false;
  clearDataButton.textContent = 'Svuota letture';

  if (clearArmedTimer) {
    clearTimeout(clearArmedTimer);
    clearArmedTimer = null;
  }
}

function resetPowerButton() {
  powerArmed = false;
  powerTvButton.textContent = 'Spegni TV';
  setRemoteAvailability(latestOnline);

  if (powerArmedTimer) {
    clearTimeout(powerArmedTimer);
    powerArmedTimer = null;
  }
}

function setRemoteAvailability(online) {
  latestOnline = online;
  const broadlinkReady = Boolean(latestBroadlink.ready);
  const disabled = !online && !broadlinkReady;
  powerTvButton.disabled = disabled;
  powerRepeatButtons.forEach((button) => {
    button.disabled = disabled;
  });

  document.getElementById('remoteStatus').textContent = broadlinkReady
    ? 'BroadLink pronto'
    : (online ? 'ESP32 online' : 'Telecomando offline');
}

async function queuePowerCommand(repeatCount = 1) {
  if (latestBroadlink.ready) {
    const response = await fetch('/api/broadlink/send-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repeat_count: repeatCount,
        source: 'dashboard'
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'BroadLink non ha inviato il comando');
    }

    return result;
  }

  if (!latestOnline) {
    throw new Error('ESP32 offline: comando non accodato');
  }

  const response = await fetch('/api/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command_type: 'tv_power',
      repeat_count: repeatCount,
      device_id: 'camera-tv-esp32',
      source: 'dashboard',
      note: `Richiesto dalla dashboard x${repeatCount}`
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Comando non accodato');
  }

  return result;
}

async function sendPowerCommand() {
  if (!latestOnline && !latestBroadlink.ready) {
    setStatus('Nessun telecomando pronto: ESP32 offline e BroadLink non configurato.');
    return;
  }

  if (!powerArmed) {
    powerArmed = true;
    powerTvButton.textContent = 'Conferma spegnimento';
    setStatus('Premi di nuovo per accodare lo spegnimento della TV.');

    powerArmedTimer = setTimeout(() => {
      resetPowerButton();
      setStatus('');
    }, 10000);
    return;
  }

  powerTvButton.disabled = true;
  const usingBroadlink = Boolean(latestBroadlink.ready);
  setStatus(usingBroadlink ? 'Invio spegnimento TV via BroadLink...' : 'Spegnimento TV in coda...');

  try {
    const result = await queuePowerCommand(1);
    await refresh();
    setStatus(usingBroadlink
      ? `Spegnimento TV inviato via BroadLink (#${result.id}).`
      : `Spegnimento TV accodato (#${result.id}). L'ESP32 lo ritira al prossimo controllo.`);
  } catch (error) {
    setStatus(`Errore spegnimento TV: ${error.message}`);
  } finally {
    resetPowerButton();
  }
}

async function sendPowerTest(repeatCount) {
  setStatus(latestBroadlink.ready
    ? `Invio test BroadLink OFF x${repeatCount}...`
    : `Accodo test ESP32 OFF x${repeatCount}...`);

  try {
    const result = await queuePowerCommand(repeatCount);
    await refresh();
    setStatus(latestBroadlink.ready
      ? `Test BroadLink OFF x${repeatCount} inviato (#${result.id}).`
      : `Test ESP32 OFF x${repeatCount} accodato (#${result.id}).`);
  } catch (error) {
    setStatus(`Errore test OFF TV: ${error.message}`);
  }
}

async function cancelPendingCommand(commandId) {
  setStatus(`Annullamento comando #${commandId}...`);

  try {
    const response = await fetch('/api/commands/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Comando non annullato');
    }

    await refresh();
    setStatus(`Comando #${commandId} annullato.`);
  } catch (error) {
    setStatus(`Errore annullamento: ${error.message}`);
  }
}

async function clearData() {
  if (!clearArmed) {
    clearArmed = true;
    clearDataButton.textContent = 'Conferma svuotamento';
    setStatus('Premi di nuovo per cancellare tutte le letture, gli eventi e i comandi salvati.');

    clearArmedTimer = setTimeout(() => {
      resetClearButton();
      setStatus('');
    }, 10000);
    return;
  }

  clearDataButton.disabled = true;
  setStatus('Pulizia in corso...');

  try {
    const response = await fetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'SVUOTA' })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Pulizia non riuscita');
    }

    await refresh();
    setStatus(`Pulizia completata: ${result.readings_deleted} letture eliminate, ${result.commands_deleted} comandi eliminati.`);
  } catch (error) {
    setStatus(`Errore pulizia: ${error.message}`);
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
  autoModePill.textContent = autoOn ? 'Auto attivo' : 'Solo monitoraggio';

  if (!session.readings) {
    badge.textContent = 'In attesa';
    title.textContent = 'Nessuna sessione ancora leggibile';
    detail.textContent = 'Appena il sensore vede una presenza stabile nel letto, qui comparira il verdetto della sessione.';
  } else if (powerEvent) {
    badge.className = 'status-pill ok';
    badge.textContent = 'TV comandata';
    title.textContent = `TV comandata alle ${formatClock(powerEvent.ts)}`;
    detail.textContent = `Evento registrato con punteggio ${powerEvent.sleep_score ?? '-'} e distanza ${powerEvent.dist_filtered ?? '-'} cm.`;
  } else if (score >= threshold && threshold > 0 && !autoOn) {
    badge.className = 'status-pill warn';
    badge.textContent = 'Soglia raggiunta';
    title.textContent = 'La sessione sembra da spegnimento, ma sei in solo monitoraggio';
    detail.textContent = `Il punteggio ha raggiunto ${score}/${threshold}. Nessuno spegnimento automatico viene inviato in questa modalita.`;
  } else if (score >= threshold && threshold > 0) {
    badge.className = 'status-pill warn';
    badge.textContent = 'Da verificare';
    title.textContent = 'Soglia raggiunta, ma non vedo un evento TV';
    detail.textContent = 'Controlla eventi e comandi: potrebbe essere un problema IR, posizione del trasmettitore o registrazione evento.';
  } else {
    badge.textContent = 'Monitoraggio';
    title.textContent = 'Nessuno spegnimento nella sessione recente';
    detail.textContent = `Punteggio massimo ${score}/${threshold || '-'}. Il sistema sta ancora osservando o non ha raggiunto la soglia.`;
  }

  document.getElementById('scoreProgressFill').style.width = `${progress}%`;
  document.getElementById('scoreProgressLabel').textContent = `Punteggio massimo ${score} su soglia ${threshold || '-'}`;
  document.getElementById('deviceState').innerHTML = latestOnline
    ? '<span class="ok">Online</span>'
    : '<span class="bad">Offline</span>';
  document.getElementById('lastSeenLabel').textContent = formatTime(summary.last_ts);
  document.getElementById('pendingCommandsLabel').textContent = summary.pending_commands || 0;
}

function renderSummaryCards(summary, session, settings) {
  document.getElementById('cards').innerHTML = [
    metricCard('Letture totali', summary.readings || 0, 'Database locale'),
    metricCard('Ultima lettura', formatTime(summary.last_ts), latestOnline ? 'ESP32 online' : 'ESP32 offline'),
    metricCard('Max punteggio', session.max_sleep_score || summary.max_sleep_score || 0, `Soglia ${session.threshold || settings.sleep_threshold || '-'}`),
    metricCard('Comandi TV', summary.tv_commands || 0, 'Automatici registrati'),
    metricCard('Comandi pendenti', summary.pending_commands || 0, 'Scadono automaticamente'),
    metricCard('Modalita', Number(settings.auto_power_enabled ?? 1) === 1 ? 'Auto' : 'Monitor', 'Config letta dall ESP32')
  ].join('');
}

function renderSessionCards(session) {
  latestSession = session || {};
  const powerEvent = latestSession.session_power_event;
  const powerDetail = powerEvent
    ? `Punteggio ${powerEvent.sleep_score ?? '-'}`
    : 'Nessun evento registrato';

  document.getElementById('sessionWindow').textContent =
    `${formatShortTime(latestSession.window_start)} - ${formatShortTime(latestSession.window_end)}`;

  document.getElementById('sessionCards').innerHTML = [
    metricCard('Letture sessione', latestSession.readings || 0, latestSession.session_active ? 'Sessione attiva' : 'Sessione conclusa'),
    metricCard('Prima presenza', formatTime(latestSession.first_in_bed_ts), `Nel letto ${formatDuration(latestSession.in_bed_seconds)}`),
    metricCard('Tempo stabile', formatDuration(latestSession.stable_seconds), `${latestSession.out_of_bed_readings || 0} letture fuori letto`),
    metricCard('Max punteggio', latestSession.max_sleep_score || 0, `Soglia ${latestSession.threshold ?? '-'}`),
    metricCard('Spegnimento sessione', powerEvent ? formatTime(powerEvent.ts) : 'Mai', powerDetail),
    metricCard('Modalita firmware', latestSession.mode || '-', 'Dall ultima lettura ESP32')
  ].join('');
}

function renderSessionSummary(report) {
  document.getElementById('sessionSummaryWindow').textContent =
    `${formatShortTime(report.window_start)} - ${formatShortTime(report.window_end)}`;
  document.getElementById('sessionSummary').textContent = report.summary || '-';
  document.getElementById('sessionMetrics').innerHTML = [
    ['Nel letto', formatDuration(report.in_bed_seconds)],
    ['Stabile', formatDuration(report.stable_seconds)],
    ['Max score', report.max_sleep_score ?? 0],
    ['Comandi TV', report.tv_commands ?? 0]
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
    document.getElementById('scoreReasonText').textContent = 'Nessuna lettura disponibile.';
    document.getElementById('latestReasonMetrics').innerHTML = '';
    return;
  }

  document.getElementById('scoreReasonText').textContent =
    latest.score_reason || 'Il firmware attuale non ha ancora inviato il motivo del punteggio.';
  document.getElementById('latestReasonMetrics').innerHTML = [
    ['Ora', formatClock(latest.ts)],
    ['Score', latest.sleep_score ?? '-'],
    ['Distanza', latest.dist_filtered ? `${latest.dist_filtered} cm` : '-'],
    ['Stabile', latest.stable ? 'SI' : 'NO']
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

  document.getElementById('settingsUpdated').textContent =
    latestSettings.updated_at ? `Aggiornate ${formatTime(latestSettings.updated_at)}` : 'Valori default';
}

function renderBroadlinkStatus(status) {
  latestBroadlink = status || {};
  const statusLabel = document.getElementById('broadlinkStatus');
  const detail = document.getElementById('broadlinkDetail');

  if (!latestBroadlink.library_ready) {
    statusLabel.innerHTML = '<span class="bad">Libreria assente</span>';
    detail.textContent = latestBroadlink.library_error || 'BroadLink non disponibile.';
  } else if (latestBroadlink.ready) {
    statusLabel.innerHTML = '<span class="ok">Pronto</span>';
    detail.textContent = `${latestBroadlink.host} - codice OFF salvato`;
  } else if (latestBroadlink.host) {
    statusLabel.innerHTML = '<span class="warn">Da imparare</span>';
    detail.textContent = `${latestBroadlink.host} - codice OFF non salvato`;
  } else {
    statusLabel.innerHTML = '<span class="bad">Non configurato</span>';
    detail.textContent = 'IP BroadLink mancante.';
  }
}

async function startBroadlinkLearning() {
  broadlinkLearnStartButton.disabled = true;
  setStatus('BroadLink in apprendimento...');

  try {
    const response = await fetch('/api/broadlink/learn/start', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Apprendimento non avviato');
    }

    renderBroadlinkStatus(result);
    setStatus('Ora invia OFF x3 dall ESP32 verso il BroadLink, poi premi Salva codice OFF.');
  } catch (error) {
    setStatus(`Errore BroadLink: ${error.message}`);
  } finally {
    broadlinkLearnStartButton.disabled = false;
  }
}

async function checkBroadlinkLearning() {
  broadlinkLearnCheckButton.disabled = true;
  setStatus('Controllo codice OFF ricevuto...');

  try {
    const response = await fetch('/api/broadlink/learn/check', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Codice OFF non ricevuto');
    }

    renderBroadlinkStatus(result);
    await refresh();
    setStatus(`Codice OFF BroadLink salvato (${result.bytes} byte).`);
  } catch (error) {
    setStatus(`Errore apprendimento BroadLink: ${error.message}`);
  } finally {
    broadlinkLearnCheckButton.disabled = false;
  }
}

async function postSettings(payload) {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Impostazioni non salvate');
  }

  renderSettings(result.settings);
  return result.settings;
}

async function saveSettings(event) {
  event.preventDefault();
  setStatus('Salvataggio impostazioni...');

  const payload = {};
  Array.from(settingsForm.elements).forEach((element) => {
    if (!element.name) return;
    payload[element.name] = Number(element.value);
  });
  payload.auto_power_enabled = autoModeToggle.checked ? 1 : 0;

  try {
    await postSettings(payload);
    await refresh();
    setStatus('Impostazioni salvate. L ESP32 le leggera al prossimo controllo.');
  } catch (error) {
    setStatus(`Errore impostazioni: ${error.message}`);
  }
}

async function toggleAutoMode() {
  const enabled = autoModeToggle.checked ? 1 : 0;
  autoModeLabel.textContent = enabled ? 'Auto' : 'Monitor';
  setStatus(enabled ? 'Attivo spegnimento automatico...' : 'Passaggio a solo monitoraggio...');

  try {
    await postSettings({ auto_power_enabled: enabled });
    await refresh();
    setStatus(enabled ? 'Spegnimento automatico attivo.' : 'Solo monitoraggio attivo.');
  } catch (error) {
    autoModeToggle.checked = !autoModeToggle.checked;
    setStatus(`Errore modalita: ${error.message}`);
  }
}

function renderCalibration(calibration) {
  latestCalibration = calibration || {};
  document.getElementById('calibrationCards').innerHTML = [
    metricCard('Campioni', calibration.samples || 0, `${calibration.in_bed_samples || 0} nel letto`),
    metricCard('Distanza mediana', calibration.distance_median_cm ?? '-', `p10 ${calibration.distance_p10_cm ?? '-'} / p90 ${calibration.distance_p90_cm ?? '-'}`),
    metricCard('Range suggerito', `${calibration.suggested_min_cm ?? '-'}-${calibration.suggested_max_cm ?? '-'} cm`, `Attuale ${calibration.current_min_cm}-${calibration.current_max_cm} cm`),
    metricCard('Stabilita', `${Math.round((calibration.stable_rate || 0) * 100)}%`, `${calibration.stable_samples || 0} letture stabili`)
  ].join('');

  calibrationApplyButton.disabled = !calibration.suggested_min_cm || !calibration.suggested_max_cm;
}

function updateCalibrationWizard() {
  const title = document.getElementById('calibrationStepTitle');
  const detail = document.getElementById('calibrationStepDetail');
  const timer = document.getElementById('calibrationTimer');

  timer.textContent = calibrationSeconds > 0 ? `${calibrationSeconds}s` : '--';

  if (calibrationPhase === 'idle') {
    title.textContent = 'Pronto';
    detail.textContent = 'Sdraiati nel letto, poi avvia una sessione guidata. Alla fine potrai applicare il range consigliato.';
    calibrationStartButton.disabled = false;
    calibrationNextButton.disabled = true;
  } else if (calibrationPhase === 'in_bed') {
    title.textContent = 'Resta sdraiato';
    detail.textContent = 'Respira normalmente e resta piu fermo possibile mentre il sensore raccoglie letture.';
    calibrationStartButton.disabled = true;
    calibrationNextButton.disabled = true;
  } else if (calibrationPhase === 'out_bed_ready') {
    title.textContent = 'Ora alzati dal letto';
    detail.textContent = 'Quando sei fuori dal letto, premi passo successivo per controllare il fuori range.';
    calibrationStartButton.disabled = true;
    calibrationNextButton.disabled = false;
  } else if (calibrationPhase === 'out_bed') {
    title.textContent = 'Fuori dal letto';
    detail.textContent = 'Resta fuori dal letto per qualche secondo. Questo aiuta a capire se il range e troppo largo.';
    calibrationStartButton.disabled = true;
    calibrationNextButton.disabled = true;
  } else if (calibrationPhase === 'done') {
    title.textContent = 'Calibrazione completata';
    detail.textContent = 'Controlla il range suggerito e applicalo se ti sembra coerente con la posizione reale del sensore.';
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
  setStatus('Calibrazione: resta sdraiato per 30 secondi.');
  runCalibrationCountdown('out_bed_ready', 30);
}

function nextCalibrationStep() {
  calibrationPhase = 'out_bed';
  setStatus('Calibrazione: resta fuori dal letto per 20 secondi.');
  runCalibrationCountdown('done', 20);
}

async function applyCalibrationRange() {
  if (!latestCalibration.suggested_min_cm || !latestCalibration.suggested_max_cm) {
    setStatus('Range suggerito non disponibile.');
    return;
  }

  setStatus('Applico range letto suggerito...');
  try {
    await postSettings({
      distance_min_cm: latestCalibration.suggested_min_cm,
      distance_max_cm: latestCalibration.suggested_max_cm
    });
    await refresh();
    setStatus(`Range letto aggiornato a ${latestCalibration.suggested_min_cm}-${latestCalibration.suggested_max_cm} cm.`);
  } catch (error) {
    setStatus(`Errore calibrazione: ${error.message}`);
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
    chartCaption.textContent = 'Nessun dato nella sessione recente';
    chartTitle.textContent = chartMode === 'distance' ? 'Distanza filtrata' : 'Punteggio sonno';
    context.fillStyle = muted;
    context.font = '13px system-ui, sans-serif';
    context.fillText('Nessun dato da mostrare', 16, 36);
    return;
  }

  chartCaption.textContent =
    `${formatShortTime(points[0].ts)} - ${formatShortTime(points[points.length - 1].ts)}`;
  chartTitle.textContent = chartMode === 'distance' ? 'Distanza filtrata' : 'Punteggio sonno';

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
      { value: minSetting, label: 'Min letto', color: warn },
      { value: maxSetting, label: 'Max letto', color: warn }
    ].filter((line) => line.value > 0);
  } else {
    values = points.map((point) => Number(point.sleep_score || 0));
    const thresholdValue = Number(threshold || points.find((point) => point.threshold)?.threshold || 0);
    yMin = 0;
    yMax = Math.ceil(Math.max(...values, thresholdValue, 10) / 10) * 10;
    guideLines = thresholdValue > 0 ? [{ value: thresholdValue, label: 'Soglia', color: bad }] : [];
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
        <td class="empty-row" colspan="5">Nessun evento registrato.</td>
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
        <td class="empty-row" colspan="5">Nessun comando manuale registrato.</td>
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
          ? `<button class="small-button" type="button" data-cancel-command="${command.id}">Annulla</button>`
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
        <td class="empty-row" colspan="9">Nessuna lettura registrata.</td>
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
      <td>${row.tv_command_sent ? 'SPENTA' : ''}</td>
    </tr>
  `).join('');
}

async function refresh() {
  const [summary, settings, broadlink, sessionSummary, calibration, session, series, events, commands, readings] = await Promise.all([
    fetch('/api/summary').then((response) => response.json()),
    fetch('/api/settings').then((response) => response.json()),
    fetch('/api/broadlink/status').then((response) => response.json()),
    fetch('/api/session-summary').then((response) => response.json()),
    fetch('/api/calibration').then((response) => response.json()),
    fetch('/api/session').then((response) => response.json()),
    fetch('/api/sleep-series').then((response) => response.json()),
    fetch('/api/events?limit=20').then((response) => response.json()),
    fetch('/api/commands?limit=20').then((response) => response.json()),
    fetch('/api/readings?limit=80').then((response) => response.json())
  ]);

  latestOnline = isDeviceOnline(summary.last_ts);
  latestReadings = readings;

  renderSettings(settings);
  renderBroadlinkStatus(broadlink);
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

systemTheme.addEventListener('change', () => {
  if (currentThemePreference() === 'system') {
    applyThemePreference('system');
  }
});

powerTvButton.addEventListener('click', sendPowerCommand);
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
broadlinkLearnStartButton.addEventListener('click', startBroadlinkLearning);
broadlinkLearnCheckButton.addEventListener('click', checkBroadlinkLearning);
document.getElementById('commandRows').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cancel-command]');
  if (!button) return;
  cancelPendingCommand(Number(button.dataset.cancelCommand));
});
window.addEventListener('resize', () => renderSleepChart(latestSeries, latestSession.threshold));

applyThemePreference(currentThemePreference());
selectTab(localStorage.getItem('tvSleepTab') || 'overview');
selectChartMode(localStorage.getItem('tvSleepChart') || 'score');
chartModeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    localStorage.setItem('tvSleepChart', chartMode);
  });
});
updateCalibrationWizard();
refresh().catch((error) => {
  setStatus(`Errore caricamento dashboard: ${error.message}`);
});
setInterval(() => {
  refresh().catch((error) => {
    setStatus(`Errore aggiornamento dashboard: ${error.message}`);
  });
}, 10000);
