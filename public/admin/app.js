const API_URL = window.API_URL || '';
let isLive = false;
let isRecording = false;
let mediaStream = null;
let peerConnections = {};
let pendingIceCandidates = {};
let myChannels = [];
let selectedChannelId = null;
let editingChannelId = null;
const editChannelBtn = document.getElementById('edit-channel-btn');
const deleteChannelBtn = document.getElementById('delete-channel-btn');
const shareChannelBtn = document.getElementById('share-channel-btn');
const sharePanel = document.getElementById('share-panel');
const embedCodeText = document.getElementById('embed-code-text');
const copyEmbedBtn = document.getElementById('copy-embed-btn');
const startBroadcastBtn = document.getElementById('start-broadcast-btn');

const loaderScreen = document.getElementById('loading-screen');
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const showRegisterBtn = document.getElementById('show-register');
const showLoginBtn = document.getElementById('show-login');

const channelSelect = document.getElementById('channel-select');
const createChannelBtn = document.getElementById('create-channel-btn');
const channelForm = document.getElementById('channel-form');
const channelNameInput = document.getElementById('channel-name');
const channelDescInput = document.getElementById('channel-description');
const channelColorInput = document.getElementById('channel-color');
const saveChannelBtn = document.getElementById('save-channel-btn');
const cancelChannelBtn = document.getElementById('cancel-channel-btn');
const channelStatus = document.getElementById('channel-status');

const stopBroadcastBtn = document.getElementById('stop-broadcast-btn');
const startRecordingBtn = document.getElementById('start-recording-btn');
const stopRecordingBtn = document.getElementById('stop-recording-btn');
const recordingStatus = document.getElementById('recording-status');
const recordingsList = document.getElementById('recordings-list');
const refreshRecordingsBtn = document.getElementById('refresh-recordings-btn');
const recordingsSearch = document.getElementById('recordings-search');

const metadataModal = document.getElementById('metadata-modal');
const closeMetadataModalBtn = document.getElementById('close-metadata-modal');
const cancelMetadataBtn = document.getElementById('cancel-metadata-btn');
const saveMetadataBtn = document.getElementById('save-metadata-btn');
const editRecordingId = document.getElementById('edit-recording-id');
const editRecordingTitle = document.getElementById('edit-recording-title');
const editRecordingDescription = document.getElementById('edit-recording-description');
const editRecordingTags = document.getElementById('edit-recording-tags');

let allRecordings = [];
let allMedia = [];

// Media Library DOM refs
const mediaList = document.getElementById('media-list');
const uploadMediaBtn = document.getElementById('upload-media-btn');
const refreshMediaBtn = document.getElementById('refresh-media-btn');
const mediaSearch = document.getElementById('media-search');
const uploadMediaModal = document.getElementById('upload-media-modal');
const closeUploadModal = document.getElementById('close-upload-modal');
const uploadMediaForm = document.getElementById('upload-media-form');
const mediaFileInput = document.getElementById('media-file-input');
const mediaTitleInput = document.getElementById('media-title');
const mediaCategorySelect = document.getElementById('media-category');
const mediaTagsInput = document.getElementById('media-tags');
const uploadMediaStatus = document.getElementById('upload-media-status');
const broadcastStatus = document.getElementById('broadcast-status');
const liveIndicator = document.getElementById('live-indicator');
const recordingIdEl = document.getElementById('recording-id');
const logoutBtn = document.getElementById('logout-btn');
const listenerCountEl = document.getElementById('listener-count');

// Chat UI
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatStatus = document.getElementById('chat-status');

// Meter Logic
let meterAnalyser = null;
let meterAnimationFrame = null;
const meterCanvas = document.getElementById('audio-meter-canvas');
const meterCtx = meterCanvas ? meterCanvas.getContext('2d') : null;
let peakLevel = 0;
let peakHoldTime = 0;
const PEAK_HOLD_MAX = 60; // 1 second @ 60fps

let rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

async function loadRTCConfig() {
  try {
    const res = await apiFetch('/api/status/rtc-config');
    const data = await res.json();
    if (res.ok && data.iceServers) {
      rtcConfig = data;
      console.log('[RTC] ICE Servers loaded from server');
    }
  } catch (e) {
    console.error('[RTC] Failed to load config, using fallback:', e);
  }
}

// Audio Constraints Preferences
const audioPrefs = {
  echoCancellation: localStorage.getItem('pref_echo') !== 'false',
  noiseSuppression: localStorage.getItem('pref_noise') !== 'false',
  autoGainControl: localStorage.getItem('pref_gain') !== 'false'
};

const echoCheck = document.getElementById('echo-cancel');
const noiseCheck = document.getElementById('noise-suppress');
const gainCheck = document.getElementById('auto-gain');

function setupPrefs() {
  if (echoCheck) {
    echoCheck.checked = audioPrefs.echoCancellation;
    echoCheck.onchange = (e) => localStorage.setItem('pref_echo', e.target.checked);
  }
  if (noiseCheck) {
    noiseCheck.checked = audioPrefs.noiseSuppression;
    noiseCheck.onchange = (e) => localStorage.setItem('pref_noise', e.target.checked);
  }
  if (gainCheck) {
    gainCheck.checked = audioPrefs.autoGainControl;
    gainCheck.onchange = (e) => localStorage.setItem('pref_gain', e.target.checked);
  }
}
setupPrefs();

// --- Charting & Analytics ---
let trendChart = null;
let chartLabels = Array(20).fill(''); // 20 data points
let chartDataArr = Array(20).fill(0);
let peakListeners = 0;
let analyticsRefreshTimer = null;

async function loadAnalytics() {
  try {
    const res = await apiFetch('/api/channels');
    if (!res.ok) throw new Error('Analytics fetch failed');
    const channels = await res.json();
    renderStationRanking(channels);
  } catch (e) {
    console.error('[Analytics] Error:', e.message);
  }
}

function renderStationRanking(channels) {
  const rankingList = document.getElementById('station-ranking-list');
  if (!rankingList) return;

  // Use all channels but limit to top 5 in UI
  const sorted = [...channels].sort((a, b) => (b.listenerCount || 0) - (a.listenerCount || 0)).slice(0, 5);
  const maxListeners = Math.max(...sorted.map(c => c.listenerCount || 0), 1);

  rankingList.innerHTML = sorted.length ? sorted.map(ch => {
    const count = ch.listenerCount || 0;
    const percentage = (count / maxListeners) * 100;
    const isCurrent = String(ch.id) === String(selectedChannelId);

    return `
      <div class="ranking-item">
        <div class="rank-info">
          <span class="rank-name">${ch.name} ${isCurrent ? '<small>(Viewing)</small>' : ''}</span>
          <span class="rank-count"><i data-lucide="users" style="width:14px"></i> ${count}</span>
        </div>
        <div class="rank-bar-bg">
          <div class="rank-bar-fill" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;
  }).join('') : '<div class="chat-placeholder">No station data available.</div>';

  if (window.lucide) lucide.createIcons();
}

function startAnalyticsRefresh() {
  if (analyticsRefreshTimer) clearInterval(analyticsRefreshTimer);
  loadAnalytics();
  analyticsRefreshTimer = setInterval(loadAnalytics, 10000);
}

function initChart() {
  const ctx = document.getElementById('listener-trend-chart');
  if (!ctx) return;

  if (trendChart) {
    trendChart.destroy();
  }

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Live Listeners',
        data: chartDataArr,
        borderColor: '#00f2ea',
        backgroundColor: 'rgba(0, 242, 234, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        x: { display: false },
        y: {
          beginAtZero: true,
          suggestedMax: 5,
          grace: '5%',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 10 }, stepSize: 1 }
        }
      },
      animation: { duration: 500 }
    }
  });
}

function updateChart(newCount) {
  if (!trendChart) return;

  chartDataArr.push(newCount);
  chartDataArr.shift();

  trendChart.update('none');

  if (newCount > peakListeners) {
    peakListeners = newCount;
    const peakEl = document.getElementById('peak-listeners');
    if (peakEl) peakEl.textContent = peakListeners;
    if (selectedChannelId) {
      localStorage.setItem(`peak_listeners_${selectedChannelId}`, peakListeners);
    }
  }
}

function resetChart() {
  peakListeners = 0;
  if (selectedChannelId) {
    const saved = localStorage.getItem(`peak_listeners_${selectedChannelId}`);
    if (saved) peakListeners = parseInt(saved, 10) || 0;
  }

  const peakEl = document.getElementById('peak-listeners');
  if (peakEl) peakEl.textContent = peakListeners;

  chartDataArr = Array(20).fill(0);
  if (trendChart) {
    trendChart.data.datasets[0].data = chartDataArr;
    trendChart.update();
  }
}

initChart();

let audioContext = null;
let mediaStreamDestination = null;
let mediaRecorder = null;

function apiFetch(url, options = {}) {
  return fetch(API_URL + url, {
    ...options,
    credentials: 'include'
  });
}

async function checkAuth() {
  try {
    const res = await apiFetch('/api/auth/check');
    const data = await res.json();
    if (data.authenticated) {
      showDashboard(data.user);
      await loadRTCConfig();
      loadMyChannels();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('Auth failed:', e);
    showLogin();
  }
}

function showScreen(screenId) {
  [loaderScreen, loginScreen, dashboardScreen].forEach(s => {
    if (s.id === screenId) {
      s.classList.remove('hidden');
    } else {
      s.classList.add('hidden');
    }
  });
}

function showLogin() {
  showScreen('login-screen');
}

function showDashboard(user) {
  showScreen('dashboard-screen');
  loadRecordings();
  initChart();
  startAnalyticsRefresh();
  if (user && user.username) {
    document.getElementById('header-username').textContent = user.username;
  }
}

async function login(username, password) {
  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadRTCConfig();
    showDashboard(data.user);
    loadMyChannels();
  } catch (e) {
    loginError.textContent = e.message;
    loginError.style.color = 'var(--danger)';
  }
}

async function register(username, password) {
  try {
    loginError.textContent = 'Creating account...';
    loginError.style.color = 'var(--text-dim)';

    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    loginError.textContent = 'Account created! Logging in...';
    loginError.style.color = 'var(--success)';

    // Auto-login after registration
    setTimeout(() => login(username, password), 1000);
  } catch (e) {
    loginError.textContent = e.message;
    loginError.style.color = 'var(--danger)';
  }
}

function logout() {
  apiFetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  login(document.getElementById('username').value, document.getElementById('password').value);
});

registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  register(document.getElementById('reg-username').value, document.getElementById('reg-password').value);
});

showRegisterBtn.addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  loginError.textContent = '';
  document.querySelector('.login-box h1').textContent = 'Broadcaster Signup';
});

showLoginBtn.addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  loginError.textContent = '';
  document.querySelector('.login-box h1').textContent = 'Broadcaster Admin';
});

logoutBtn.addEventListener('click', logout);

async function loadMyChannels() {
  try {
    const res = await apiFetch('/api/channels/my/channels');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load channels');
    myChannels = Array.isArray(data) ? data : [];
    renderChannelSelector();
  } catch (e) {
    console.error('Failed to load channels:', e);
    myChannels = [];
    channelStatus.textContent = 'Failed to load channels: ' + e.message;
  }
}

function renderChannelSelector() {
  if (!Array.isArray(myChannels)) {
    myChannels = [];
  }

  if (myChannels.length === 0) {
    channelSelect.innerHTML = '<option value="">No channels yet - create one!</option>';
    startBroadcastBtn.disabled = true;
    return;
  }

  channelSelect.innerHTML = '<option value="">Select a channel...</option>' +
    myChannels.map(ch => `<option value="${ch.id}">${ch.name} ${ch.isLive ? '(LIVE)' : ''}</option>`).join('');

  if (selectedChannelId) {
    channelSelect.value = selectedChannelId;
  } else {
    const active = sessionStorage.getItem('activeChannelId');
    if (active && myChannels.some(c => String(c.id) === String(active))) {
      selectedChannelId = active;
      channelSelect.value = selectedChannelId;
      console.log('[Auto-Resume] Active session detected, resuming station:', selectedChannelId);

      // Short delay for socket/auth to fully settle
      setTimeout(() => {
        if (!isLive) startBroadcast(selectedChannelId);
      }, 500);
    }
  }

  startBroadcastBtn.disabled = !selectedChannelId;
  editChannelBtn.disabled = !selectedChannelId;
  deleteChannelBtn.disabled = !selectedChannelId;
  shareChannelBtn.disabled = !selectedChannelId;
}

channelSelect.addEventListener('change', () => {
  selectedChannelId = channelSelect.value;
  sessionStorage.setItem('lastSelectedChannelId', selectedChannelId); // Extra persistence
  const channel = myChannels.find(c => String(c.id) === String(selectedChannelId));

  if (channel?.isLive) {
    broadcastStatus.textContent = 'This channel is live';
    liveIndicator.textContent = '● Live';
    liveIndicator.className = 'indicator live';
    startBroadcastBtn.disabled = true;
    stopBroadcastBtn.disabled = false;
    isLive = true;
  } else {
    broadcastStatus.textContent = 'Select a channel to start broadcasting';
    liveIndicator.textContent = '● Offline';
    liveIndicator.className = 'indicator offline';
    startBroadcastBtn.disabled = !selectedChannelId;
    stopBroadcastBtn.disabled = true;
    isLive = false;
  }

  startRecordingBtn.disabled = !isLive;
  editChannelBtn.disabled = !selectedChannelId;
  deleteChannelBtn.disabled = !selectedChannelId;
  shareChannelBtn.disabled = !selectedChannelId;
  sharePanel.classList.add('hidden');
  // Refresh analytics/charts for the new channel
  resetChart();
  initChart();
  startAnalyticsRefresh();
  loadMedia();
});

shareChannelBtn.addEventListener('click', () => {
  if (!selectedChannelId) return;
  const isHidden = sharePanel.classList.toggle('hidden');
  if (!isHidden) {
    const embedUrl = `${window.location.origin}/embed.html?channel=${selectedChannelId}`;
    const iframeCode = `<iframe src="${embedUrl}" width="100%" height="80" frameborder="0" allow="autoplay"></iframe>`;
    embedCodeText.textContent = iframeCode;
  }
});

copyEmbedBtn.addEventListener('click', () => {
  const code = embedCodeText.textContent;
  navigator.clipboard.writeText(code).then(() => {
    const originalText = copyEmbedBtn.textContent;
    copyEmbedBtn.textContent = 'Copied!';
    copyEmbedBtn.classList.replace('primary-small', 'success-small'); // Use success color if exists
    setTimeout(() => {
      copyEmbedBtn.textContent = originalText;
      copyEmbedBtn.classList.replace('success-small', 'primary-small');
    }, 2000);
  });
});

editChannelBtn.addEventListener('click', () => {
  const channel = myChannels.find(c => c.id === selectedChannelId);
  if (!channel) return;

  editingChannelId = channel.id;
  channelNameInput.value = channel.name;
  channelDescInput.value = channel.description || '';
  channelColorInput.value = channel.color || '#e94560';
  document.querySelector('#channel-form h3').textContent = 'Edit Station';

  channelForm.classList.remove('hidden');
  createChannelBtn.classList.add('hidden');
});

deleteChannelBtn.addEventListener('click', async () => {
  if (!selectedChannelId) return;
  const channel = myChannels.find(c => c.id === selectedChannelId);
  if (!channel) return;

  if (!confirm(`Are you sure you want to delete "${channel.name}"? This will remove all associated recordings data from the database!`)) return;

  try {
    const res = await apiFetch(`/api/channels/${selectedChannelId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('Channel deleted');
    selectedChannelId = null;
    loadMyChannels();
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

createChannelBtn.addEventListener('click', () => {
  channelForm.classList.remove('hidden');
  createChannelBtn.classList.add('hidden');
});

cancelChannelBtn.addEventListener('click', () => {
  channelForm.classList.add('hidden');
  createChannelBtn.classList.remove('hidden');
  channelNameInput.value = '';
  channelDescInput.value = '';
  editingChannelId = null;
  document.querySelector('#channel-form h3').textContent = 'New Station';
  channelStatus.textContent = '';
});

saveChannelBtn.addEventListener('click', async () => {
  const name = channelNameInput.value.trim();
  const description = channelDescInput.value.trim();
  const color = channelColorInput.value;

  if (!name) {
    channelStatus.textContent = 'Channel name is required';
    return;
  }

  try {
    const url = editingChannelId ? `/api/channels/${editingChannelId}` : '/api/channels';
    const method = editingChannelId ? 'PUT' : 'POST';

    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, color })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    channelStatus.textContent = editingChannelId ? 'Station updated!' : 'Station created!';
    channelStatus.style.color = '#00d9a5';

    setTimeout(() => {
      channelForm.classList.add('hidden');
      createChannelBtn.classList.remove('hidden');
      channelNameInput.value = '';
      channelDescInput.value = '';
      channelStatus.textContent = '';
      editingChannelId = null;
      document.querySelector('#channel-form h3').textContent = 'New Station';
    }, 1000);

    loadMyChannels();
  } catch (e) {
    channelStatus.textContent = e.message;
    channelStatus.style.color = '#e94560';
  }
});

function encodeWAV(buffers, sampleRate) {
  const numChannels = 1;
  const format = 1;
  const bitDepth = 16;

  const length = buffers[0].length;
  const dataSize = length * numChannels * (bitDepth / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, buffers[0][i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function startBroadcast(channelId) {
  if (!channelId) {
    broadcastStatus.textContent = 'Please select a station first';
    return;
  }

  try {
    const constraints = {
      audio: {
        echoCancellation: echoCheck ? echoCheck.checked : true,
        noiseSuppression: noiseCheck ? noiseCheck.checked : true,
        autoGainControl: gainCheck ? gainCheck.checked : true,
        sampleRate: 44100,
        channelCount: 2
      },
      video: false
    };

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[Broadcast] Got media stream with constraints:', constraints.audio);

    audioContext = new AudioContext({ sampleRate: 44100 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    mediaStreamDestination = audioContext.createMediaStreamDestination();
    source.connect(mediaStreamDestination);

    initAudioMeter(source);

    if (!socket.connected) {
      broadcastStatus.textContent = 'Socket not connected. Please refresh.';
      return;
    }

    socket.emit('join-channel', { channelId, role: 'broadcaster' });

    setTimeout(() => {
      socket.emit('broadcaster-ready', { channelId });
    }, 100);

    startBroadcastBtn.disabled = true;
    stopBroadcastBtn.disabled = false;
    startRecordingBtn.disabled = false;
    broadcastStatus.textContent = 'Broadcasting...';
    liveIndicator.textContent = '● Live';
    liveIndicator.className = 'indicator live';
    isLive = true;

    sessionStorage.setItem('activeChannelId', channelId);

    // Auto-resume recording if it was active
    if (sessionStorage.getItem('isRecordingActive') === 'true') {
      console.log('[Auto-Resume] Resuming recording stream...');
      setTimeout(() => startRecordingStream(), 1000);
    }
  } catch (e) {
    console.error('[Broadcast] Error starting:', e);
    broadcastStatus.textContent = 'Error: ' + e.message;
  }
}

startBroadcastBtn.addEventListener('click', () => startBroadcast(selectedChannelId));

stopBroadcastBtn.addEventListener('click', () => {
  if (isRecording) {
    alert('Stop recording first');
    return;
  }

  socket.emit('stop-broadcasting', { channelId: selectedChannelId });

  Object.values(peerConnections).forEach(pc => { try { pc.close(); } catch (e) { } });
  peerConnections = {};

  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }

  startBroadcastBtn.disabled = false;
  stopBroadcastBtn.disabled = true;
  startRecordingBtn.disabled = true;
  broadcastStatus.textContent = 'Broadcast stopped';
  liveIndicator.textContent = '● Offline';
  liveIndicator.className = 'indicator offline';
  isLive = false;

  stopAudioMeter();

  sessionStorage.removeItem('activeChannelId');
});

async function startRecordingStream() {
  if (!audioContext || !mediaStreamDestination) {
    console.warn('[Recording] Broadcast must be active to record');
    return;
  }

  try {
    // Notify server we are starting (if not already recorded)
    socket.emit('start-recording', { channelId: selectedChannelId });

    mediaRecorder = new MediaRecorder(mediaStreamDestination.stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && isRecording) {
        socket.emit('audio-chunk', event.data);
      }
    };

    mediaRecorder.start(1000); // 1s chunks
    isRecording = true;
    startRecordingBtn.disabled = true;
    stopRecordingBtn.disabled = false;
    recordingStatus.textContent = 'Recording (Streaming)...';
    sessionStorage.setItem('isRecordingActive', 'true');
  } catch (e) {
    console.error('[Recording] Failed to start:', e);
    recordingStatus.textContent = 'Error: ' + e.message;
  }
}

startRecordingBtn.addEventListener('click', startRecordingStream);

stopRecordingBtn.addEventListener('click', async () => {
  if (!isRecording) return;

  isRecording = false;
  stopRecordingBtn.disabled = true;
  recordingStatus.textContent = 'Finalizing Recording...';

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Server handles the finalization
  socket.emit('stop-recording', { channelId: selectedChannelId });

  sessionStorage.removeItem('isRecordingActive');
  mediaRecorder = null;
});

function initAudioMeter(source) {
  if (!audioContext || !meterCtx) return;

  meterAnalyser = audioContext.createAnalyser();
  meterAnalyser.fftSize = 256;
  source.connect(meterAnalyser);

  // Resize canvas to match display size
  const dpr = window.devicePixelRatio || 1;
  const rect = meterCanvas.getBoundingClientRect();
  meterCanvas.width = rect.width * dpr;
  meterCanvas.height = rect.height * dpr;
  meterCtx.scale(dpr, dpr);

  drawMeter();
}

function stopAudioMeter() {
  if (meterAnimationFrame) {
    cancelAnimationFrame(meterAnimationFrame);
    meterAnimationFrame = null;
  }
  if (meterCtx) {
    meterCtx.clearRect(0, 0, meterCanvas.width, meterCanvas.height);
  }
}

function drawMeter() {
  if (!meterAnalyser || !isLive) return;

  const bufferLength = meterAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  meterAnalyser.getByteFrequencyData(dataArray);

  // Calculate RMS/Volume
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / bufferLength);
  const normalizedValue = Math.min(1, rms / 128); // Normalize to 0-1

  const width = meterCanvas.clientWidth;
  const height = meterCanvas.clientHeight;
  meterCtx.clearRect(0, 0, width, height);

  // Background track
  meterCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  meterCtx.fillRect(0, 0, width, height);

  // Gradient based on level
  const gradient = meterCtx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, '#00f2ea'); // Cyan
  gradient.addColorStop(0.6, '#ffd60a'); // Yellow
  gradient.addColorStop(1, '#ff2d55'); // Red

  const barHeight = height * normalizedValue;
  meterCtx.fillStyle = gradient;
  meterCtx.fillRect(0, height - barHeight, width, barHeight);

  // Peak hold logic
  if (normalizedValue > peakLevel) {
    peakLevel = normalizedValue;
    peakHoldTime = PEAK_HOLD_MAX;
  } else if (peakHoldTime > 0) {
    peakHoldTime--;
  } else {
    peakLevel *= 0.95; // Decay
  }

  // Draw Peak line
  if (peakLevel > 0.01) {
    meterCtx.fillStyle = peakLevel > 0.8 ? '#ff2d55' : 'rgba(255, 255, 255, 0.5)';
    meterCtx.fillRect(0, height - (height * peakLevel), width, 2);
  }

  meterAnimationFrame = requestAnimationFrame(drawMeter);
}

// --- Live Chat Logic ---
socket.on('chat-history', (data) => {
  if (data.channelId !== selectedChannelId) return;
  chatMessages.innerHTML = '';
  if (data.messages.length === 0) {
    chatMessages.innerHTML = '<div class="chat-placeholder">No messages yet. Start the conversation!</div>';
  } else {
    data.messages.forEach(msg => appendMessage(msg));
  }
});

socket.on('new-message', (msg) => {
  if (msg.channel_id !== selectedChannelId) return;

  // Remove placeholder if it exists
  const placeholder = chatMessages.querySelector('.chat-placeholder');
  if (placeholder) placeholder.remove();

  appendMessage(msg);
});

function appendMessage(msg) {
  const currentUsername = document.getElementById('header-username')?.textContent || 'Broadcaster';
  const isOwn = msg.username === currentUsername || msg.username === 'Broadcaster' || msg.username === 'admin';

  const div = document.createElement('div');
  div.className = `message-item ${isOwn ? 'own' : ''}`;

  div.innerHTML = `
    <div class="message-meta">${msg.username} • ${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    <div class="chat-bubble">${msg.content}</div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content || !selectedChannelId) return;

  const currentUsername = document.getElementById('header-username')?.textContent || 'Broadcaster';

  socket.emit('send-message', {
    channelId: selectedChannelId,
    content,
    username: currentUsername
  });

  chatInput.value = '';
});

async function loadRecordings() {
  try {
    const res = await apiFetch('/api/recordings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recordings');
    allRecordings = Array.isArray(data) ? data : [];
    renderRecordings(allRecordings);
  } catch (e) {
    console.error(e);
    allRecordings = [];
    renderRecordings([]);
  }
}

function renderRecordings(recordings) {
  if (!Array.isArray(recordings)) {
    recordings = [];
  }

  if (recordings.length === 0) {
    recordingsList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="music"></i>
        <p>No recordings found yet.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  recordingsList.innerHTML = recordings.map(r => {
    const title = r.title || r.filename || 'Untitled Recording';
    const tags = Array.isArray(r.tags) ? r.tags : (r.tags ? r.tags.split(',') : []);

    return `
      <div class="recording-item glass-card">
        <div class="recording-info">
          <div class="rec-title">${title}</div>
          <div class="rec-filename">${r.filename}</div>
          ${r.description ? `<div class="rec-description">${r.description}</div>` : ''}
          <div class="rec-meta">
            ${new Date(r.created_at).toLocaleString()} • ${formatSize(r.filesize)}
          </div>
          ${tags.length > 0 ? `
            <div class="rec-tags">
              ${tags.map(t => `<span class="tag-pill">${t.trim()}</span>`).join('')}
            </div>
          ` : ''}
        </div>
        <div class="recording-actions">
          <button class="btn-icon play" data-id="${r.id}" title="Play"><i data-lucide="play-circle"></i></button>
          <button class="btn-icon edit" data-id="${r.id}" title="Edit Info"><i data-lucide="edit-3"></i></button>
          <button class="btn-icon download" data-id="${r.id}" title="Download"><i data-lucide="download"></i></button>
          <button class="btn-icon delete" data-id="${r.id}" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();

  recordingsList.querySelectorAll('.play').forEach(b => b.onclick = () => playRecording(b.dataset.id));
  recordingsList.querySelectorAll('.edit').forEach(b => b.onclick = () => openMetadataModal(b.dataset.id));
  recordingsList.querySelectorAll('.download').forEach(b => b.onclick = () => window.open(API_URL + `/api/recordings/${b.dataset.id}/download`, '_blank'));
  recordingsList.querySelectorAll('.delete').forEach(b => b.onclick = async () => {
    if (confirm('Permanently delete this recording?')) {
      try {
        const res = await apiFetch(`/api/recordings/${b.dataset.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        loadRecordings();
      } catch (e) { alert(e.message); }
    }
  });
}

function openMetadataModal(id) {
  const rec = allRecordings.find(r => r.id === id);
  if (!rec) return;

  editRecordingId.value = rec.id;
  editRecordingTitle.value = rec.title || '';
  editRecordingDescription.value = rec.description || '';
  editRecordingTags.value = Array.isArray(rec.tags) ? rec.tags.join(', ') : (rec.tags || '');

  metadataModal.classList.remove('hidden');
}

function closeMetadataModal() {
  metadataModal.classList.add('hidden');
}

async function saveMetadata() {
  const id = editRecordingId.value;
  const title = editRecordingTitle.value;
  const description = editRecordingDescription.value;
  const tags = editRecordingTags.value.split(',').map(t => t.trim()).filter(t => t !== '');

  saveMetadataBtn.disabled = true;
  saveMetadataBtn.textContent = 'Saving...';

  try {
    const res = await apiFetch(`/api/recordings/${id}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, tags })
    });

    if (!res.ok) throw new Error('Failed to update metadata');

    closeMetadataModal();
    loadRecordings();
  } catch (e) {
    alert(e.message);
  } finally {
    saveMetadataBtn.disabled = false;
    saveMetadataBtn.textContent = 'Save Changes';
  }
}

recordingsSearch.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = allRecordings.filter(r => {
    const title = (r.title || '').toLowerCase();
    const filename = (r.filename || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const tags = Array.isArray(r.tags) ? r.tags.join(' ') : (r.tags || '');

    return title.includes(query) ||
      filename.includes(query) ||
      desc.includes(query) ||
      tags.toLowerCase().includes(query);
  });
  renderRecordings(filtered);
});

closeMetadataModalBtn.addEventListener('click', closeMetadataModal);
cancelMetadataBtn.addEventListener('click', closeMetadataModal);
saveMetadataBtn.addEventListener('click', saveMetadata);
refreshRecordingsBtn.addEventListener('click', loadRecordings);

async function playRecording(id) {
  let player = document.getElementById('audio-player');
  if (!player) {
    player = document.createElement('div');
    player.id = 'audio-player';
    player.className = 'show';
    document.querySelector('.recordings-section').appendChild(player);
  }

  try {
    const res = await apiFetch(`/api/recordings/${id}/stream`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    player.innerHTML = `<audio controls autoplay src="${url}"></audio>`;
  } catch (e) { console.error(e); }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function handleOffer(sdp, socketId) {
  console.log('Received offer from listener:', socketId);
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[socketId] = pc;
  pendingIceCandidates[socketId] = [];

  if (mediaStreamDestination) {
    pc.addTrack(mediaStreamDestination.stream.getAudioTracks()[0], mediaStreamDestination.stream);
  }

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { target: socketId, candidate: e.candidate, channelId: selectedChannelId });
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    console.log('Remote description set, creating answer...');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('Sending answer to listener:', socketId);
    socket.emit('answer', { socketId, sdp: answer.sdp, channelId: selectedChannelId });
    console.log('Answer sent!');
  } catch (e) { console.error('Error handling offer:', e); }
}

socket.on('offer', d => handleOffer(d.sdp, d.socketId));

socket.on('ice-candidate', async d => {
  const pc = peerConnections[d.socketId];
  if (pc?.remoteDescription?.type) {
    await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
  } else if (pc) {
    (pendingIceCandidates[d.socketId] = pendingIceCandidates[d.socketId] || []).push(d.candidate);
  }
});

socket.on('listener-joined', d => console.log('Listener:', d.socketId));

socket.on('channel-live', (data) => {
  console.log('Channel live status:', data);
  if (data.channelId === selectedChannelId) {
    isLive = data.isLive;
    liveIndicator.textContent = data.isLive ? '● Live' : '● Offline';
    liveIndicator.className = 'indicator ' + (data.isLive ? 'live' : 'offline');
    broadcastStatus.textContent = data.isLive ? 'Broadcasting' : 'Stopped';
    startRecordingBtn.disabled = !data.isLive;

    if (data.isLive) {
      startBroadcastBtn.disabled = true;
      stopBroadcastBtn.disabled = false;
    } else {
      startBroadcastBtn.disabled = false;
      stopBroadcastBtn.disabled = true;
    }
  }

  loadMyChannels();
});

socket.on('listener-count', (data) => {
  console.log('Listener count:', data);
  if (data.channelId === selectedChannelId) {
    listenerCountEl.innerHTML = `<i data-lucide="users"></i> ${data.count}`;
    lucide.createIcons();
    updateChart(data.count);
  }
});

socket.on('recording-started', (data) => {
  console.log('Recording started:', data);
  recordingIdEl.textContent = `Recording ID: ${data.id}`;
});

socket.on('recording-stopped', (data) => {
  console.log('Recording stopped:', data);
  recordingStatus.textContent = 'Recording saved!';
  loadRecordings();
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
});

socket.io.on('reconnect', (attempt) => {
  console.log('Reconnected after', attempt, 'attempts');
  loadMyChannels();
});

socket.on('error', m => alert(m));

checkAuth();

// =============================================
// PHASE 7 — MEDIA LIBRARY LOGIC
// =============================================

const CATEGORY_META = {
  music: { label: '🎵 Music', color: 'var(--primary)' },
  show: { label: '🎙️ Show', color: '#a78bfa' },
  jingle: { label: '✨ Jingle', color: '#fbbf24' },
  ad: { label: '🗣️ Ad', color: '#34d399' }
};

async function loadMedia() {
  if (!selectedChannelId) return;
  try {
    const res = await apiFetch(`/api/media?channelId=${selectedChannelId}`);
    const data = await res.json();
    allMedia = Array.isArray(data) ? data : [];
    renderMedia(allMedia);
  } catch (e) {
    console.error('Failed to load media library:', e);
    allMedia = [];
    renderMedia([]);
  }
}

function renderMedia(items) {
  if (!mediaList) return;
  if (!items.length) {
    mediaList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="audio-lines"></i>
        <p>No custom media uploaded yet. Click <b>Upload</b> to get started.</p>
      </div>`;
    lucide.createIcons();
    return;
  }

  mediaList.innerHTML = items.map(item => {
    const meta = CATEGORY_META[item.category] || { label: item.category, color: '#94a3b8' };
    const date = new Date(item.created_at).toLocaleDateString();
    return `
      <div class="recording-item" data-id="${item.id}">
        <div class="rec-info">
          <div class="rec-header">
            <span class="rec-title" title="${item.title}">${item.title}</span>
            <span class="media-badge" style="background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}55">${meta.label}</span>
          </div>
          <div class="rec-meta">
            <span>${date}</span>
            ${item.tags && item.tags.length ? `<span>• ${item.tags.slice(0, 3).join(', ')}</span>` : ''}
          </div>
        </div>
        <div class="rec-actions">
          ${item.cloud_url ? `<a href="${item.cloud_url}" target="_blank" class="btn-icon play" title="Preview"><i data-lucide="play-circle"></i></a>` : ''}
          <button class="btn-icon delete" title="Delete" onclick="deleteMedia('${item.id}')"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  }).join('');

  lucide.createIcons();
}

async function deleteMedia(id) {
  if (!confirm('Delete this media file? This cannot be undone.')) return;
  try {
    const res = await apiFetch(`/api/media/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allMedia = allMedia.filter(m => m.id !== id);
      renderMedia(allMedia);
    } else {
      const d = await res.json();
      alert(d.error || 'Delete failed');
    }
  } catch (e) {
    console.error('Delete media error:', e);
  }
}

if (mediaSearch) {
  mediaSearch.addEventListener('input', () => {
    const q = mediaSearch.value.toLowerCase();
    renderMedia(allMedia.filter(m =>
      m.title.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      (m.tags || []).some(t => t.toLowerCase().includes(q))
    ));
  });
}

if (uploadMediaBtn) {
  uploadMediaBtn.addEventListener('click', () => {
    if (!selectedChannelId) { alert('Please select a station first.'); return; }
    uploadMediaModal.classList.remove('hidden');
  });
}

if (closeUploadModal) {
  closeUploadModal.addEventListener('click', () => {
    uploadMediaModal.classList.add('hidden');
    uploadMediaForm.reset();
    uploadMediaStatus.textContent = '';
  });
}

if (refreshMediaBtn) {
  refreshMediaBtn.addEventListener('click', loadMedia);
}

if (uploadMediaForm) {
  uploadMediaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedChannelId) return;

    const file = mediaFileInput.files[0];
    if (!file) return;

    uploadMediaStatus.textContent = '⏳ Uploading...';
    const submitBtn = document.getElementById('submit-media-btn');
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append('mediaFile', file);
    formData.append('channelId', selectedChannelId);
    formData.append('title', mediaTitleInput.value.trim() || file.name);
    formData.append('category', mediaCategorySelect.value);
    formData.append('tags', mediaTagsInput.value);

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        credentials: 'include',
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        uploadMediaStatus.textContent = '✅ Upload successful!';
        uploadMediaStatus.style.color = 'var(--success)';
        uploadMediaForm.reset();
        await loadMedia();
        setTimeout(() => {
          uploadMediaModal.classList.add('hidden');
          uploadMediaStatus.textContent = '';
        }, 1500);
      } else {
        uploadMediaStatus.textContent = `❌ ${data.error || 'Upload failed'}`;
        uploadMediaStatus.style.color = 'var(--danger)';
      }
    } catch (err) {
      console.error('Upload error:', err);
      uploadMediaStatus.textContent = '❌ Network error during upload';
      uploadMediaStatus.style.color = 'var(--danger)';
    } finally {
      submitBtn.disabled = false;
    }
  });
}
