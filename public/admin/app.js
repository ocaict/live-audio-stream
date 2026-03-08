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

const loaderScreen = document.getElementById('loading-screen');
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

const channelSelect = document.getElementById('channel-select');
const createChannelBtn = document.getElementById('create-channel-btn');
const channelForm = document.getElementById('channel-form');
const channelNameInput = document.getElementById('channel-name');
const channelDescInput = document.getElementById('channel-description');
const channelColorInput = document.getElementById('channel-color');
const saveChannelBtn = document.getElementById('save-channel-btn');
const cancelChannelBtn = document.getElementById('cancel-channel-btn');
const channelStatus = document.getElementById('channel-status');

const startBroadcastBtn = document.getElementById('start-broadcast-btn');
const stopBroadcastBtn = document.getElementById('stop-broadcast-btn');
const broadcastStatus = document.getElementById('broadcast-status');
const liveIndicator = document.getElementById('live-indicator');

const startRecordingBtn = document.getElementById('start-recording-btn');
const stopRecordingBtn = document.getElementById('stop-recording-btn');
const recordingStatus = document.getElementById('recording-status');
const recordingIdEl = document.getElementById('recording-id');

const logoutBtn = document.getElementById('logout-btn');
const listenerCountEl = document.getElementById('listener-count');
const recordingsList = document.getElementById('recordings-list');

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  ]
};

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

// --- Charting ---
let trendChart = null;
let chartLabels = Array(20).fill(''); // 20 data points
let chartDataArr = Array(20).fill(0);
let peakListeners = 0;

function initChart() {
  const ctx = document.getElementById('listener-trend-chart');
  if (!ctx) return;

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
      showDashboard();
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

function showDashboard() {
  showScreen('dashboard-screen');
  loadRecordings();
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
    showDashboard();
    loadMyChannels();
  } catch (e) { loginError.textContent = e.message; }
}

function logout() {
  apiFetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  login(document.getElementById('username').value, document.getElementById('password').value);
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
  resetChart();
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

async function loadRecordings() {
  try {
    const res = await apiFetch('/api/recordings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recordings');
    renderRecordings(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error(e);
    renderRecordings([]);
  }
}

function renderRecordings(recordings) {
  if (!Array.isArray(recordings)) {
    recordings = [];
  }

  if (recordings.length === 0) {
    recordingsList.innerHTML = '<p class="empty">No recordings</p>';
    return;
  }

  recordingsList.innerHTML = recordings.map(r => `
    <div class="recording-item">
      <div class="recording-info">
        <div class="filename">${r.filename}</div>
        <div class="meta">${new Date(r.created_at).toLocaleString()} • ${formatSize(r.filesize)}</div>
      </div>
      <div class="recording-actions">
        <button class="play" data-id="${r.id}">Play</button>
        <button class="download" data-id="${r.id}">Download</button>
        <button class="delete" data-id="${r.id}">Delete</button>
      </div>
    </div>
  `).join('');

  recordingsList.querySelectorAll('.play').forEach(b => b.onclick = () => playRecording(b.dataset.id));
  recordingsList.querySelectorAll('.download').forEach(b => b.onclick = () => window.open(API_URL + `/api/recordings/${b.dataset.id}/download`, '_blank'));
  recordingsList.querySelectorAll('.delete').forEach(b => b.onclick = async () => {
    if (confirm('Delete?')) {
      await apiFetch(`/api/recordings/${b.dataset.id}`, { method: 'DELETE' });
      loadRecordings();
    }
  });
}

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
