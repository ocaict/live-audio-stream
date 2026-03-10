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
const muteMicBtn = document.getElementById('mute-mic-btn');
const muteIcon = document.getElementById('mute-icon');

let isMuted = false;

// Chat UI
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatStatus = document.getElementById('chat-status');
const chatDrawer = document.getElementById('chat-drawer');
const chatToggleBtn = document.getElementById('chat-toggle-floating');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatBadge = document.getElementById('chat-badge');

// Playlists & Schedule DOM refs
const playlistsList = document.getElementById('playlists-list');
const scheduleTable = document.getElementById('schedule-table');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const addScheduleBtn = document.getElementById('add-schedule-btn');
const playlistModal = document.getElementById('playlist-modal');
const closePlaylistModal = document.getElementById('close-playlist-modal');
const playlistForm = document.getElementById('playlist-form');
const scheduleModal = document.getElementById('schedule-modal');
const closeScheduleModal = document.getElementById('close-schedule-modal');
const scheduleForm = document.getElementById('schedule-form');
const schedulePlaylistSelect = document.getElementById('schedule-playlist-select');

// Jingle Pad DOM refs
const jinglePadSection = document.getElementById('jingle-pad-section');
const jingleGrid = document.getElementById('jingle-grid');
const jingleVolumeSlider = document.getElementById('jingle-volume-slider');
const stopAllJinglesBtn = document.getElementById('stop-all-jingles-btn');

// Call-In Queue DOM refs
const callInSection = document.getElementById('call-in-section');
const callQueueList = document.getElementById('call-queue-list');
const activeCallBadge = document.getElementById('active-call-badge');

// Studio Clock DOM refs
const studioTimeEl = document.getElementById('studio-time');
const studioDateEl = document.getElementById('studio-date');
const broadcastDurationEl = document.getElementById('broadcast-duration');
const onAirTimerContainer = document.getElementById('on-air-timer');
const clockOnAirIndicator = document.getElementById('clock-on-air-indicator');
const utcTimeDisplay = document.getElementById('utc-time-display');
const localTimeDisplay = document.getElementById('local-time-display');

// Playback Bar DOM refs
const playbackBar = document.getElementById('playback-bar');
const audioPlayer = document.getElementById('audio-player');
const pbTitle = document.getElementById('pb-title');
const pbMeta = document.getElementById('pb-meta');
const closePbBtn = document.getElementById('close-pb-btn');

let pendingCallers = [];
let activeCall = null; // { socketId, username, pc, streamNode, gainNode }
let broadcastStartTime = null;

let allPlaylists = [];
let allSchedules = [];
let selectedPlaylistId = null;

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
      // Force socket to reconnect to ensure it has the latest session cookie
      if (window.socket && !socket.connected) {
        socket.connect();
      } else if (window.socket) {
        // Even if connected, it might have connected before the cookie was set/updated
        console.log('[Auth] Syncing socket session...');
        socket.disconnect().connect();
      }

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

    // Force socket to reconnect so it picks up the login cookie for authentication
    if (window.socket) {
      console.log('[Auth] Reconnecting socket to pick up session...');
      socket.disconnect().connect();
    }

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

// Login / Register Form Toggle
if (showRegisterBtn) {
  showRegisterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  });
}
if (showLoginBtn) {
  showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });
}

// --- TAB SWITCHING LOGIC ---
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabButtons.forEach(btn => {
  btn.addEventListener('click', async () => {
    const tabId = btn.getAttribute('data-tab');

    // Update button states
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update panel visibility
    tabPanels.forEach(p => p.classList.remove('active'));
    const activePanel = document.getElementById(`${tabId}-tab`);
    if (activePanel) activePanel.classList.add('active');

    // Trigger tab-specific refreshes
    if (tabId === 'library') {
      await loadMedia();
      await loadRecordings();
    } else if (tabId === 'scheduling') {
      await loadPlaylists(); // Order matters here for renderSchedules
      await loadSchedules();
    } else if (tabId === 'analytics') {
      // Any specific analytics refresh
    }

    // Re-trigger Lucide icons for any new content
    if (window.lucide) lucide.createIcons();
  });
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

  startBroadcastBtn.disabled = !selectedChannelId || isLive;
  editChannelBtn.disabled = !selectedChannelId || isLive;
  deleteChannelBtn.disabled = !selectedChannelId || isLive;
  shareChannelBtn.disabled = !selectedChannelId;
}

channelSelect.addEventListener('change', () => {
  selectedChannelId = channelSelect.value;
  sessionStorage.setItem('lastSelectedChannelId', selectedChannelId); // Extra persistence
  if (selectedChannelId) {
    loadPlaylists();
    loadSchedules();
    socket.emit('join-channel', { channelId: selectedChannelId, role: 'broadcaster' });
  }

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
  editChannelBtn.disabled = !selectedChannelId || isLive;
  deleteChannelBtn.disabled = !selectedChannelId || isLive;
  shareChannelBtn.disabled = !selectedChannelId;
  sharePanel.classList.add('hidden');
  // Refresh analytics/charts for the new channel
  resetChart();
  initChart();
  startAnalyticsRefresh();
  loadMedia();

  if (selectedChannelId) {
    socket.emit('get-autodj-status', { channelId: selectedChannelId });
  }
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

    // Auto-Open the chat drawer for the broadcaster
    if (chatDrawer && !chatDrawer.classList.contains('open')) {
      chatDrawer.classList.add('open');
      if (chatBadge) chatBadge.classList.add('hidden');
    }

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
    if (jinglePadSection) jinglePadSection.classList.remove('hidden');
    if (callInSection) callInSection.classList.remove('hidden');
    if (muteMicBtn) muteMicBtn.disabled = false;

    // Visual Clock Start
    broadcastStartTime = Date.now();
    document.body.classList.add('broadcasting-live');
    if (onAirTimerContainer) onAirTimerContainer.classList.remove('inactive');
    if (clockOnAirIndicator) clockOnAirIndicator.textContent = 'ON AIR';

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
  if (muteMicBtn) {
    muteMicBtn.disabled = true;
    muteMicBtn.classList.remove('is-muted');
    isMuted = false;
    if (muteIcon) muteIcon.setAttribute('data-lucide', 'mic');
    if (window.lucide) lucide.createIcons();
  }
  broadcastStatus.textContent = 'Broadcast stopped';
  liveIndicator.textContent = '● Offline';
  liveIndicator.className = 'indicator offline';
  isLive = false;
  if (jinglePadSection) jinglePadSection.classList.add('hidden');
  if (callInSection) callInSection.classList.add('hidden');
  if (activeCall) dropCall(activeCall.socketId);
  pendingCallers = [];
  renderCallQueue();

  // Visual Clock Reset
  broadcastStartTime = null;
  document.body.classList.remove('broadcasting-live');
  if (onAirTimerContainer) onAirTimerContainer.classList.add('inactive');
  if (clockOnAirIndicator) clockOnAirIndicator.textContent = 'OFF AIR';
  if (broadcastDurationEl) broadcastDurationEl.textContent = '00:00:00';

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
  if (!meterCtx) return;

  meterAnalyser = audioContext.createAnalyser();
  meterAnalyser.fftSize = 256;
  source.connect(meterAnalyser);

  // Size the canvas AFTER the browser has painted the layout.
  // getBoundingClientRect() returns 0x0 if called before first paint.
  requestAnimationFrame(() => {
    resizeMeterCanvas();
    drawMeter();
  });

  // Keep canvas buffer in sync if the panel resizes (e.g. window resize)
  if (window._meterResizeObserver) window._meterResizeObserver.disconnect();
  window._meterResizeObserver = new ResizeObserver(() => resizeMeterCanvas());
  window._meterResizeObserver.observe(meterCanvas);
}

function resizeMeterCanvas() {
  const dpr = window.devicePixelRatio || 1;
  // offsetWidth/Height give real pixel dims even before first getBoundingClientRect
  const w = meterCanvas.offsetWidth || meterCanvas.clientWidth || 200;
  const h = meterCanvas.offsetHeight || meterCanvas.clientHeight || 120;
  if (meterCanvas.width !== Math.round(w * dpr) || meterCanvas.height !== Math.round(h * dpr)) {
    meterCanvas.width = Math.round(w * dpr);
    meterCanvas.height = Math.round(h * dpr);
    meterCtx.scale(dpr, dpr);
  }
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
  if (!meterAnalyser) return;

  const bufferLength = meterAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  meterAnalyser.getByteFrequencyData(dataArray);

  // Calculate RMS/Volume
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / bufferLength);
  const normalizedValue = Math.min(1, rms / 128);

  // Always use offsetWidth/Height — they reflect CSS layout size
  const width = meterCanvas.offsetWidth || meterCanvas.clientWidth || 200;
  const height = meterCanvas.offsetHeight || meterCanvas.clientHeight || 120;
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

socket.on('message-deleted', (data) => {
  if (data.channelId !== selectedChannelId) return;
  const msgEl = document.querySelector(`.message-item[data-id="${data.messageId}"]`);
  if (msgEl) {
    msgEl.classList.add('deleted');
    setTimeout(() => msgEl.remove(), 300);
  }
});

socket.on('chat-cleared', (data) => {
  if (data.channelId !== selectedChannelId) return;
  chatMessages.innerHTML = '<div class="chat-placeholder">No messages yet. Start the conversation!</div>';
});

function appendMessage(msg) {
  const currentUsername = document.getElementById('header-username')?.textContent || 'Broadcaster';
  const isOwn = msg.username === currentUsername;
  const isAdmin = msg.is_admin === true;
  const isSystem = msg.is_system === true;

  const div = document.createElement('div');
  div.className = `message-item ${isOwn ? 'own' : ''} ${isSystem ? 'is-system' : ''} ${isAdmin ? 'is-admin' : ''}`;
  div.dataset.id = msg.id;

  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.innerHTML = `
    <div class="message-meta">
      <span class="meta-text"></span>
      <button class="delete-msg-btn" onclick="deleteMessage('${msg.id}')" title="Delete Message">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>
    <div class="chat-bubble"></div>
  `;

  // Safely inject untrusted user data using textContent to prevent XSS
  div.querySelector('.meta-text').textContent = `${msg.username} • ${time}`;
  div.querySelector('.chat-bubble').textContent = msg.content;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Badge Logic: if drawer closed and not my message
  if (chatDrawer && !chatDrawer.classList.contains('open') && !isOwn && chatBadge) {
    chatBadge.classList.remove('hidden');
  }
}

if (chatToggleBtn) {
  chatToggleBtn.addEventListener('click', () => {
    chatDrawer.classList.add('open');
    if (chatBadge) chatBadge.classList.add('hidden');
  });
}

if (closeChatBtn) {
  closeChatBtn.addEventListener('click', () => {
    chatDrawer.classList.remove('open');
  });
}

window.deleteMessage = (messageId) => {
  if (confirm('Delete this message?')) {
    socket.emit('delete-message', { messageId, channelId: selectedChannelId });
  }
};

const clearChatBtn = document.getElementById('clear-chat-btn');
if (clearChatBtn) {
  clearChatBtn.addEventListener('click', () => {
    if (confirm('ARE YOU SURE? This will permanently wipe ALL chat history for this station.')) {
      socket.emit('clear-chat', { channelId: selectedChannelId });
    }
  });
}

let chatCooldown = false;
if (chatForm) chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (chatCooldown) return;

  const content = chatInput.value.trim();
  if (!content || !selectedChannelId) return;

  const currentUsername = document.getElementById('header-username')?.textContent || 'Broadcaster';

  socket.emit('send-message', {
    channelId: selectedChannelId,
    content,
    username: currentUsername
  });

  chatInput.value = '';

  // Cooldown
  chatCooldown = true;
  const submitBtn = document.getElementById('send-chat-btn');
  if (submitBtn) submitBtn.disabled = true;

  setTimeout(() => {
    chatCooldown = false;
    if (submitBtn) submitBtn.disabled = false;
  }, 2000);
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
          <button class="btn-icon promote" data-id="${r.id}" title="Promote to Auto-DJ"><i data-lucide="list-plus"></i></button>
          <button class="btn-icon edit" data-id="${r.id}" title="Edit Info"><i data-lucide="edit-3"></i></button>
          <button class="btn-icon download" data-id="${r.id}" title="Download"><i data-lucide="download"></i></button>
          <button class="btn-icon delete" data-id="${r.id}" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();

  recordingsList.querySelectorAll('.play').forEach(b => b.onclick = () => playRecording(b.dataset.id));
  recordingsList.querySelectorAll('.promote').forEach(b => b.onclick = () => promoteRecording(b.dataset.id));
  recordingsList.querySelectorAll('.edit').forEach(b => b.onclick = () => openMetadataModal(b.dataset.id));
  recordingsList.querySelectorAll('.download').forEach(b => b.onclick = () => window.open(API_URL + `/api/recordings/${b.dataset.id}/download`, '_blank'));
  recordingsList.querySelectorAll('.delete').forEach(b => b.onclick = async () => {
    if (confirm('Permanently delete this recording?')) {
      try {
        const res = await apiFetch(`/api/recordings/${b.dataset.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            throw new Error(data.error || 'Delete failed');
          }
          throw new Error(`Delete failed (Status: ${res.status})`);
        }
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

async function promoteRecording(id) {
  const rec = allRecordings.find(r => r.id === id);
  if (!rec) return;

  if (!confirm(`Add "${rec.title || 'this recording'}" to the Auto-DJ rotation library?`)) return;

  try {
    const res = await apiFetch(`/api/recordings/${id}/promote`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Promotion failed');

    alert('✅ Recording successfully promoted to Auto-DJ rotation!');
    loadMedia(); // Refresh media library view
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function playRecording(id) {
  if (!playbackBar || !audioPlayer) return;

  const recording = allRecordings.find(r => r.id === id);
  const title = recording ? (recording.title || recording.filename) : 'Recording';

  // Setup Bar UI
  if (pbTitle) pbTitle.textContent = title;
  if (pbMeta) pbMeta.textContent = recording ? new Date(recording.created_at).toLocaleString() : 'Streaming...';

  const streamUrl = `${API_URL}/api/recordings/${id}/stream`;
  audioPlayer.src = streamUrl;

  playbackBar.classList.remove('hidden');
  audioPlayer.play().catch(err => console.warn('[Playback] Autoplay failed:', err));
}

// Wire up close button
if (closePbBtn) {
  closePbBtn.addEventListener('click', () => {
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.src = '';
    }
    if (playbackBar) {
      playbackBar.classList.add('hidden');
    }
  });
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
  startRecordingBtn.disabled = !isLive;
  stopRecordingBtn.disabled = true;
  loadRecordings();
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
});

socket.io.on('reconnect', (attempt) => {
  console.log('Reconnected after', attempt, 'attempts');
  loadMyChannels();
});

socket.on('error', (msg) => {
  if (msg === 'Authentication required to broadcast') {
    console.warn('[Socket] Authentication required. Resyncing session...');
    socket.disconnect().connect();
    // After reconnecting, we might want to retry the last action, 
    // but usually the UI state allows the user to just try again.
  } else {
    alert(msg);
  }
});

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
    renderJinglePad();
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
      <div class="recording-item draggable-media" data-id="${item.id}" draggable="true">
        <div class="drag-handle" style="cursor: grab; color: var(--text-dim); padding-right: 12px;">
          <i data-lucide="grip-vertical"></i>
        </div>
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
          ${item.cloud_url ? `<button class="btn-icon play" title="Preview" onclick="previewMedia('${item.cloud_url}')"><i data-lucide="play-circle"></i></button>` : ''}
          <button class="btn-icon add-pl" title="Add to selected playlist" onclick="addMediaToSelectedPlaylist('${item.id}')"><i data-lucide="plus"></i></button>
          <button class="btn-icon delete" title="Delete" onclick="deleteMedia('${item.id}')"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  }).join('');

  lucide.createIcons();
  setupMediaDragAndDrop();
}

let currentPreviewAudio = null;
window.previewMedia = (url) => {
  if (currentPreviewAudio) {
    currentPreviewAudio.pause();
    if (currentPreviewAudio.src === url) {
      currentPreviewAudio = null; // Toggle pause if same track clicked
      return;
    }
  }
  currentPreviewAudio = new Audio(url);
  currentPreviewAudio.play().catch(e => console.error('Preview error:', e));
};

function setupMediaDragAndDrop() {
  const draggables = document.querySelectorAll('.draggable-media');
  if (!draggables.length || !mediaList) return;

  draggables.forEach(draggable => {
    draggable.addEventListener('dragstart', () => {
      draggable.classList.add('dragging');
      draggable.style.opacity = '0.5';
    });

    draggable.addEventListener('dragend', async () => {
      draggable.classList.remove('dragging');
      draggable.style.opacity = '1';

      const orderedIds = [...mediaList.querySelectorAll('.draggable-media')].map(el => el.dataset.id);

      // Update local allMedia array implicitly, but re-render isn't needed right now since UI is already ordered
      allMedia.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));

      // Save new order to backend
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`${API_URL}/api/media/reorder`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ channelId: selectedChannelId, orderedIds })
        });
        console.log('Media rotation order saved!');
      } catch (err) {
        console.error('Failed to save media order:', err);
      }
    });
  });

  mediaList.addEventListener('dragover', e => {
    e.preventDefault();
    const afterElement = getDragAfterElement(mediaList, e.clientY);
    const draggable = document.querySelector('.dragging');
    if (!draggable) return;
    if (afterElement == null) {
      mediaList.appendChild(draggable);
    } else {
      mediaList.insertBefore(draggable, afterElement);
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.draggable-media:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function deleteMedia(id) {
  if (!confirm('Delete this media file? This cannot be undone.')) return;
  try {
    const res = await apiFetch(`/api/media/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allMedia = allMedia.filter(m => m.id !== id);
      renderMedia(allMedia);
    } else {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const d = await res.json();
        alert(d.error || 'Delete failed');
      } else {
        alert(`Delete failed (Status: ${res.status})`);
      }
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

// --- JINGLE PAD LOGIC ---
let activeJinglePlayers = [];

function renderJinglePad() {
  if (!jingleGrid) return;

  const jingles = allMedia.filter(m => m.category === 'jingle');

  if (jingles.length === 0) {
    jingleGrid.innerHTML = '<div class="empty-state small">No jingles found in library.</div>';
    return;
  }

  jingleGrid.innerHTML = jingles.map(j => `
    <div class="jingle-btn" data-id="${j.id}" onclick="playJingle('${j.id}', '${j.cloud_url}')">
      <i data-lucide="music"></i>
      <span class="jingle-name" title="${j.title}">${j.title}</span>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

window.playJingle = (id, url) => {
  if (!isLive || !audioContext || !mediaStreamDestination) {
    alert('Jingles can only be triggered while you are Broadcasting Live!');
    return;
  }

  const btn = document.querySelector(`.jingle-btn[data-id="${id}"]`);
  if (btn) btn.classList.add('playing');

  const audio = new Audio(url);
  audio.crossOrigin = 'anonymous';

  const sourceNode = audioContext.createMediaElementSource(audio);
  const jingleGain = audioContext.createGain();

  // Set initial volume from slider
  jingleGain.gain.value = jingleVolumeSlider ? parseFloat(jingleVolumeSlider.value) : 0.8;

  sourceNode.connect(jingleGain);
  jingleGain.connect(mediaStreamDestination);

  audio.play().catch(e => console.error('Jingle play error:', e));

  const playerObj = { id, audio, gain: jingleGain };
  activeJinglePlayers.push(playerObj);

  audio.onended = () => {
    if (btn) btn.classList.remove('playing');
    activeJinglePlayers = activeJinglePlayers.filter(p => p !== playerObj);
    jingleGain.disconnect();
    sourceNode.disconnect();
  };
};

if (stopAllJinglesBtn) {
  stopAllJinglesBtn.addEventListener('click', () => {
    activeJinglePlayers.forEach(p => {
      p.audio.pause();
      p.audio.currentTime = 0;
      const btn = document.querySelector(`.jingle-btn[data-id="${p.id}"]`);
      if (btn) btn.classList.remove('playing');
      p.gain.disconnect();
    });
    activeJinglePlayers = [];
  });
}

if (jingleVolumeSlider) {
  jingleVolumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    activeJinglePlayers.forEach(p => {
      p.gain.gain.setTargetAtTime(vol, audioContext.currentTime, 0.05);
    });
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

// =============================================
// PHASE 7 — AUTO-DJ ADMIN CONTROLS
// =============================================
const autoDJStartBtn = document.getElementById('autodj-start-btn');
const autoDJStopBtn = document.getElementById('autodj-stop-btn');
const autoDJSkipBtn = document.getElementById('autodj-skip-btn');
const autoDJStatusBadge = document.getElementById('autodj-status-badge');
const autoDJNowPlaying = document.getElementById('autodj-now-playing');
const autoDJTrackTitle = document.getElementById('autodj-track-title');

// Monitor UI
const autoDJMonitorBtn = document.getElementById('autodj-monitor-btn');
const monitorIcon = document.getElementById('monitor-icon');
const monitorVolumeArea = document.getElementById('monitor-volume-area');
const monitorVolumeSlider = document.getElementById('monitor-volume');

let monitorActive = false;
let monitorAudioCtx = null;
let monitorGainNode = null;
let monitorNextStartTime = 0;
let monitorVolume = 0.5;

function setAutoDJState(running) {
  const currentlyLive = isLive || myChannels.find(c => String(c.id) === String(selectedChannelId))?.isLive;
  if (autoDJStartBtn) autoDJStartBtn.disabled = running || currentlyLive;
  if (autoDJStopBtn) autoDJStopBtn.disabled = !running;
  if (autoDJSkipBtn) autoDJSkipBtn.disabled = !running;

  if (running) {
    autoDJStatusBadge.textContent = '● Running';
    autoDJStatusBadge.style.cssText = 'background:rgba(0,242,234,0.15);color:#00f2ea;border:1px solid rgba(0,242,234,0.4);padding:4px 8px;border-radius:6px;font-size:0.75rem;font-weight:500;white-space:nowrap;';
  } else {
    autoDJStatusBadge.textContent = '● Offline';
    autoDJStatusBadge.style.cssText = 'background:rgba(255,45,85,0.15);color:#ff2d55;border:1px solid rgba(255,45,85,0.3);padding:4px 8px;border-radius:6px;font-size:0.75rem;font-weight:500;white-space:nowrap;';
    if (autoDJNowPlaying) autoDJNowPlaying.style.display = 'none';
  }
}

if (autoDJStartBtn) {
  autoDJStartBtn.addEventListener('click', () => {
    socket.emit('admin-start-autodj', { channelId: selectedChannelId });
  });
}
if (autoDJStopBtn) {
  autoDJStopBtn.addEventListener('click', () => {
    socket.emit('admin-stop-autodj', { channelId: selectedChannelId });
  });
}
if (autoDJSkipBtn) {
  autoDJSkipBtn.addEventListener('click', () => {
    socket.emit('admin-skip-track', { channelId: selectedChannelId });
  });
}

socket.on('autodj-started', ({ channelId }) => {
  if (channelId !== selectedChannelId) return;
  setAutoDJState(true);
});

socket.on('autodj-stopped', ({ channelId }) => {
  if (channelId !== selectedChannelId) return;
  setAutoDJState(false);
});

socket.on('autodj-track-changed', (meta) => {
  if (meta.channelId !== selectedChannelId) return;
  const emoji = { music: '🎵', show: '🎙️', jingle: '✨', ad: '🗣️' }[meta.category] || '📻';
  if (autoDJTrackTitle) autoDJTrackTitle.textContent = emoji + ' ' + meta.title + ' (' + meta.index + '/' + meta.total + ')';
  if (autoDJNowPlaying) autoDJNowPlaying.style.display = 'block';
});

// Handle the server's response to get-autodj-status (fired when admin selects a channel)
socket.on('autodj-status', ({ channelId, isRunning, currentTrack }) => {
  if (channelId !== selectedChannelId) return;
  setAutoDJState(isRunning);
  if (isRunning && currentTrack) {
    const emoji = { music: '🎵', show: '🎙️', jingle: '✨', ad: '🗣️' }[currentTrack.category] || '📻';
    if (autoDJTrackTitle) autoDJTrackTitle.textContent = emoji + ' ' + currentTrack.title + ' (' + currentTrack.index + '/' + currentTrack.total + ')';
    if (autoDJNowPlaying) autoDJNowPlaying.style.display = 'block';
  }
});

// --- Broadcaster Monitor Logic ---

function initMonitorAudio() {
  if (!monitorAudioCtx) {
    monitorAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    monitorGainNode = monitorAudioCtx.createGain();
    monitorGainNode.gain.value = monitorVolume;
    monitorGainNode.connect(monitorAudioCtx.destination);

    // Visual Monitor Integration
    if (meterCanvas) {
      if (!meterAnalyser) {
        meterAnalyser = monitorAudioCtx.createAnalyser();
        meterAnalyser.fftSize = 256;
      }
      monitorGainNode.connect(meterAnalyser);
      drawMeter();
    }
  }
}

function scheduleMonitorChunk(rawBuffer) {
  if (!monitorAudioCtx || !monitorActive) return;

  // Convert raw bytes (PCM s16le) -> Float32
  const int16 = new Int16Array(rawBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

  const audioBuffer = monitorAudioCtx.createBuffer(1, float32.length, 44100);
  audioBuffer.copyToChannel(float32, 0);

  const source = monitorAudioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(monitorGainNode);

  const startAt = Math.max(monitorNextStartTime, monitorAudioCtx.currentTime + 0.05);
  source.start(startAt);
  monitorNextStartTime = startAt + audioBuffer.duration;
}

if (autoDJMonitorBtn) {
  autoDJMonitorBtn.addEventListener('click', () => {
    monitorActive = !monitorActive;
    if (monitorActive) {
      initMonitorAudio();
      autoDJMonitorBtn.classList.add('active');
      autoDJMonitorBtn.style.color = 'var(--primary)';
      autoDJMonitorBtn.style.borderColor = 'var(--primary)';
      monitorVolumeArea.classList.remove('hidden');
    } else {
      autoDJMonitorBtn.classList.remove('active');
      autoDJMonitorBtn.style.color = '';
      autoDJMonitorBtn.style.borderColor = '';
      monitorVolumeArea.classList.add('hidden');
    }
  });
}

if (monitorVolumeSlider) {
  monitorVolumeSlider.addEventListener('input', (e) => {
    monitorVolume = parseFloat(e.target.value);
    if (monitorGainNode) monitorGainNode.gain.value = monitorVolume;
  });
}

socket.on('dj-audio-chunk', (payload) => {
  if (!monitorActive || payload.channelId !== selectedChannelId) return;
  const raw = payload.chunk || payload;
  const buffer = raw instanceof ArrayBuffer ? raw : raw.buffer || raw;
  scheduleMonitorChunk(buffer);
});

socket.on('autodj-control-ack', (data) => {
  console.log('[AutoDJ] Control ack:', data);
});

socket.on('autodj-no-media', ({ channelId }) => {
  if (channelId !== selectedChannelId) return;
  alert('No media in the library for this station. Upload tracks first.');
  setAutoDJState(false);
});

socket.on('autodj-status', (data) => {
  if (data.channelId !== selectedChannelId) return;
  setAutoDJState(data.isRunning);
  if (data.isRunning && data.currentTrack) {
    const meta = data.currentTrack;
    const emoji = { music: '🎵', show: '🎙️', jingle: '✨', ad: '🗣️' }[meta.category] || '📻';
    if (autoDJTrackTitle) autoDJTrackTitle.textContent = emoji + ' ' + meta.title + ' (' + meta.index + '/' + (meta.total || '?') + ')';
    if (autoDJNowPlaying) autoDJNowPlaying.style.display = 'block';
  }
});

// --- Playlists & Schedules Management ---

async function loadPlaylists() {
  if (!selectedChannelId) return;
  try {
    const res = await apiFetch(`/api/playlists/channel/${selectedChannelId}`);
    allPlaylists = await res.json();
    renderPlaylists();
    updateSchedulePlaylistSelect();
  } catch (err) {
    console.error('Failed to load playlists:', err);
  }
}

function renderPlaylists() {
  if (!playlistsList) return;

  if (allPlaylists.length === 0) {
    playlistsList.innerHTML = '<div class="empty-state small">No playlists yet.</div>';
    return;
  }

  playlistsList.innerHTML = allPlaylists.map(pl => `
    <div class="mini-item ${selectedPlaylistId === pl.id ? 'active' : ''}" onclick="selectPlaylist('${pl.id}')">
      <div class="info">
        <h4>${pl.name}</h4>
        <p>${pl.description || 'No description'}</p>
      </div>
      <button class="btn-small-icon" onclick="deletePlaylist(event, '${pl.id}')">
        <i data-lucide="trash-2" style="width:14px"></i>
      </button>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function updateSchedulePlaylistSelect() {
  if (!schedulePlaylistSelect) return;
  schedulePlaylistSelect.innerHTML = allPlaylists.map(pl =>
    `<option value="${pl.id}">${pl.name}</option>`
  ).join('');
}

window.selectPlaylist = (id) => {
  selectedPlaylistId = id;
  renderPlaylists();
  console.log('Playlist selected:', id);
};

window.deletePlaylist = async (e, id) => {
  e.stopPropagation();
  if (!confirm('Delete this playlist?')) return;
  try {
    const res = await apiFetch(`/api/playlists/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allPlaylists = allPlaylists.filter(p => p.id !== id);
      if (selectedPlaylistId === id) selectedPlaylistId = null;
      renderPlaylists();
      loadSchedules();
    }
  } catch (err) { console.error(err); }
};

window.addMediaToSelectedPlaylist = async (mediaId) => {
  if (!selectedPlaylistId) {
    alert('Please select a playlist from the sidebar first!');
    return;
  }

  try {
    // Get current items for this playlist
    const res = await apiFetch(`/api/playlists/${selectedPlaylistId}`);
    const playlist = await res.json();
    const currentIds = (playlist.items || []).map(i => i.media_library.id);

    if (currentIds.includes(mediaId)) {
      alert('This track is already in the playlist.');
      return;
    }

    currentIds.push(mediaId);

    const updateRes = await apiFetch(`/api/playlists/${selectedPlaylistId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaIds: currentIds })
    });

    if (updateRes.ok) {
      alert('Track added to playlist!');
    }
  } catch (err) { console.error(err); }
};

async function loadSchedules() {
  if (!selectedChannelId) return;
  try {
    const res = await apiFetch(`/api/schedules/channel/${selectedChannelId}`);
    allSchedules = await res.json();
    renderSchedules();
  } catch (err) {
    console.error('Failed to load schedules:', err);
  }
}

function renderSchedules() {
  if (!scheduleTable) return;

  if (allSchedules.length === 0) {
    scheduleTable.innerHTML = '<div class="empty-state small">No scheduled programs yet. Set one up to structure your broadcast!</div>';
    return;
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  scheduleTable.innerHTML = `
    <div class="schedule-row schedule-header-row">
      <div>Day</div>
      <div>Playlist</div>
      <div>Time Window</div>
      <div>Action</div>
    </div>
    ${allSchedules.map(sch => {
    const pl = allPlaylists.find(p => p.id === sch.playlist_id);
    return `
        <div class="schedule-row">
          <div><span class="day-badge">${days[sch.day_of_week]}</span></div>
          <div style="font-weight:500;">${pl ? pl.name : 'Unknown Playlist'}</div>
          <div class="time-range">${sch.start_time.substring(0, 5)} — ${sch.end_time.substring(0, 5)}</div>
          <div>
            <button class="btn-small-icon" onclick="deleteSchedule('${sch.id}')" title="Remove slot">
              <i data-lucide="trash-2" style="width:14px"></i>
            </button>
          </div>
        </div>
      `;
  }).join('')}
  `;
  if (window.lucide) lucide.createIcons();
}

window.deleteSchedule = async (id) => {
  if (!confirm('Remove this program slot?')) return;
  try {
    const res = await apiFetch(`/api/schedules/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allSchedules = allSchedules.filter(s => s.id !== id);
      renderSchedules();
    }
  } catch (err) { console.error(err); }
};

// Modal Toggle Handlers
if (createPlaylistBtn) {
  createPlaylistBtn.addEventListener('click', () => {
    if (!selectedChannelId) {
      alert('Please select a station first!');
      return;
    }
    playlistModal.classList.remove('hidden');
  });
}

if (closePlaylistModal) {
  closePlaylistModal.addEventListener('click', () => {
    playlistModal.classList.add('hidden');
    playlistForm.reset();
  });
}

if (addScheduleBtn) {
  addScheduleBtn.addEventListener('click', () => {
    if (allPlaylists.length === 0) {
      alert('Please create at least one playlist first.');
      return;
    }
    scheduleModal.classList.remove('hidden');
    updateStudioClock(); // Update times immediately
  });
}

if (closeScheduleModal) {
  closeScheduleModal.addEventListener('click', () => {
    scheduleModal.classList.add('hidden');
    scheduleForm.reset();
  });
}

// Form Handlers
if (playlistForm) {
  playlistForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('playlist-name').value.trim();
    const description = document.getElementById('playlist-description').value.trim();

    if (!name) return;
    if (!selectedChannelId) {
      alert('Station context lost. Please re-select your station.');
      return;
    }

    try {
      const res = await apiFetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannelId, name, description })
      });
      if (res.ok) {
        playlistModal.classList.add('hidden');
        playlistForm.reset();
        loadPlaylists();
      } else {
        const errData = await res.json();
        alert('Failed to create playlist: ' + (errData.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Playlist creation error:', err);
      alert('Network error while creating playlist.');
    }
  });
}

if (scheduleForm) {
  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const playlistId = document.getElementById('schedule-playlist-select').value;
    const dayOfWeek = parseInt(document.getElementById('schedule-day').value);
    const startTime = document.getElementById('schedule-start').value;
    const endTime = document.getElementById('schedule-end').value;

    if (!playlistId || !startTime || !endTime) return;

    try {
      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannelId,
          playlistId,
          dayOfWeek,
          startTime: startTime + ':00',
          endTime: endTime + ':00'
        })
      });
      if (res.ok) {
        scheduleModal.classList.add('hidden');
        scheduleForm.reset();
        loadSchedules();
      } else {
        const data = await res.json();
        alert('Schedule conflict or error: ' + (data.error || 'Check overlaps'));
      }
    } catch (err) {
      console.error('Schedule creation error:', err);
      alert('Network error while saving schedule.');
    }
  });
}

// Initial Sync
channelSelect.addEventListener('change', () => {
  if (selectedChannelId) {
    loadPlaylists();
    loadSchedules();
  }
});

// --- CALL-IN SYSTEM LOGIC ---

function renderCallQueue() {
  if (!callQueueList) return;

  if (pendingCallers.length === 0 && !activeCall) {
    callQueueList.innerHTML = '<div class="empty-state small">No pending callers.</div>';
    return;
  }

  const items = [];

  // Active call first
  if (activeCall) {
    items.push(`
      <div class="call-item active-call">
        <div class="caller-icon"><i data-lucide="mic"></i></div>
        <div class="caller-info">
          <span class="caller-name">${activeCall.username}</span>
          <span class="caller-meta" style="color:var(--success)">LIVE ON AIR</span>
        </div>
        <div class="call-actions">
          <button class="btn danger-small" onclick="dropCall('${activeCall.socketId}')">Drop</button>
        </div>
      </div>
    `);
  }

  // Pending requests
  pendingCallers.forEach(c => {
    items.push(`
      <div class="call-item">
        <div class="caller-icon"><i data-lucide="user"></i></div>
        <div class="caller-info">
          <span class="caller-name">${c.username}</span>
          <span class="caller-meta">Waiting to talk...</span>
        </div>
        <div class="call-actions">
          <button class="btn success-small" onclick="acceptCall('${c.socketId}', '${c.username}')">Accept</button>
          <button class="btn secondary-small" onclick="rejectCall('${c.socketId}')">Reject</button>
        </div>
      </div>
    `);
  });

  callQueueList.innerHTML = items.join('');
  if (window.lucide) lucide.createIcons();
}

window.acceptCall = async (socketId, username) => {
  if (activeCall) {
    alert('One call at a time! Drop the current call first.');
    return;
  }

  console.log(`[Call-In] Accepting call from ${username} (${socketId})`);
  socket.emit('accept-call', { channelId: selectedChannelId, targetSocketId: socketId });

  activeCall = { socketId, username };
  pendingCallers = pendingCallers.filter(c => c.socketId !== socketId);

  if (activeCallBadge) activeCallBadge.classList.remove('hidden');
  renderCallQueue();
};

window.rejectCall = (socketId) => {
  socket.emit('reject-call', { channelId: selectedChannelId, targetSocketId: socketId });
  pendingCallers = pendingCallers.filter(c => c.socketId !== socketId);
  renderCallQueue();
};

window.dropCall = (socketId) => {
  socket.emit('drop-call', { channelId: selectedChannelId, targetSocketId: socketId });

  if (activeCall && activeCall.socketId === socketId) {
    if (activeCall.pc) activeCall.pc.close();
    if (activeCall.streamNode) activeCall.streamNode.disconnect();
    if (activeCall.gainNode) activeCall.gainNode.disconnect();
    activeCall = null;
    if (activeCallBadge) activeCallBadge.classList.add('hidden');
  }

  renderCallQueue();
};

// Signaling for the call peer
socket.on('call-request', (data) => {
  console.log('[Call-In] New call request:', data);
  pendingCallers.push(data);
  renderCallQueue();
});

socket.on('call-request-cancelled', (data) => {
  pendingCallers = pendingCallers.filter(c => c.socketId !== data.socketId);
  renderCallQueue();
});

socket.on('call-offer', async (data) => {
  if (!activeCall || activeCall.socketId !== data.socketId) return;
  console.log('[Call-In] Got call offer from', data.socketId);

  try {
    const pc = new RTCPeerConnection(rtcConfig);
    activeCall.pc = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('call-ice', {
          candidate,
          channelId: selectedChannelId,
          targetSocketId: data.socketId,
          toBroadcaster: false
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('[Call-In] Received caller audio track!');
      const stream = event.streams[0];

      if (audioContext && mediaStreamDestination) {
        const callerGain = audioContext.createGain();
        callerGain.gain.value = 0.8; // Initial volume

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(callerGain);
        callerGain.connect(mediaStreamDestination);

        activeCall.streamNode = source;
        activeCall.gainNode = callerGain;
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('call-answer', {
      sdp: answer.sdp,
      channelId: selectedChannelId,
      targetSocketId: data.socketId
    });

  } catch (err) {
    console.error('[Call-In] Failed to handle call offer:', err);
    dropCall(data.socketId);
  }
});

socket.on('call-ice', async (data) => {
  if (activeCall && activeCall.socketId === data.socketId && activeCall.pc) {
    await activeCall.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

// --- LOGOUT ---
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    if (confirm('Log out from OcaTech-Live?')) {
      logout();
    }
  });
}

// --- VISUAL RADIO CLOCK LOGIC ---

function updateStudioClock() {
  const now = new Date();

  // Update Current Local Time
  if (studioTimeEl) {
    studioTimeEl.textContent = now.toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  // Update Date
  if (studioDateEl) {
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const dateStr = `${days[now.getDay()]}, ${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}`;
    studioDateEl.textContent = dateStr;
  }

  // Update Broadcast Duration
  if (isLive && broadcastStartTime && broadcastDurationEl) {
    const diff = Math.floor((Date.now() - broadcastStartTime) / 1000);
    const hrs = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    const secs = diff % 60;

    broadcastDurationEl.textContent =
      `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Update Modal Timezone indicators if open
  if (scheduleModal && !scheduleModal.classList.contains('hidden')) {
    if (utcTimeDisplay) {
      utcTimeDisplay.textContent = now.getUTCHours().toString().padStart(2, '0') + ':' +
        now.getUTCMinutes().toString().padStart(2, '0') + ':' +
        now.getUTCSeconds().toString().padStart(2, '0');
    }
    if (localTimeDisplay) {
      localTimeDisplay.textContent = now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0') + ':' +
        now.getUTCSeconds().toString().padStart(2, '0');
    }
  }
}

// Start the clock pulse
setInterval(updateStudioClock, 1000);
updateStudioClock();

// --- MUTE SYSTEM ---
if (muteMicBtn) {
  muteMicBtn.addEventListener('click', () => {
    if (!mediaStream) return;

    isMuted = !isMuted;

    // Toggle audio tracks
    mediaStream.getAudioTracks().forEach(track => {
      track.enabled = !isMuted;
    });

    // Update UI
    if (isMuted) {
      muteMicBtn.classList.add('is-muted');
      muteMicBtn.title = 'Unmute Microphone';
      if (muteIcon) muteIcon.setAttribute('data-lucide', 'mic-off');
    } else {
      muteMicBtn.classList.remove('is-muted');
      muteMicBtn.title = 'Mute Microphone';
      if (muteIcon) muteIcon.setAttribute('data-lucide', 'mic');
    }

    if (window.lucide) lucide.createIcons();
    console.log(`[Audio] Microphone ${isMuted ? 'MUTED' : 'UNMUTED'}`);
  });
}

/**
 * Socket Auto-Rejoin & Re-auth Logic
 * Ensures that if the socket disconnects and reconnects (blips, or login re-handshake),
 * the server-side channel state and broadcaster authorization are restored.
 */
socket.on('connect', () => {
  console.log('[Socket] Connected / Reconnected. ID:', socket.id);

  if (typeof selectedChannelId !== 'undefined' && selectedChannelId) {
    console.log('[Socket] Auto-joining channel:', selectedChannelId);
    socket.emit('join-channel', { channelId: selectedChannelId, role: 'broadcaster' });

    if (typeof isLive !== 'undefined' && isLive) {
      console.log('[Socket] Resuming live broadcaster status for channel:', selectedChannelId);
      socket.emit('broadcaster-ready', { channelId: selectedChannelId });
    }
  }
});
