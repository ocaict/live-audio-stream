const API_URL = window.API_URL || '';
let isLive = false;
let isRecording = false;
let mediaStream = null;
let peerConnections = {};
let pendingIceCandidates = {};
let myChannels = [];
let selectedChannelId = null;

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

let audioContext = null;
let mediaStreamDestination = null;
let recordedBuffers = [];

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
    myChannels = await res.json();
    renderChannelSelector();
  } catch (e) {
    console.error('Failed to load channels:', e);
    channelStatus.textContent = 'Failed to load channels';
  }
}

function renderChannelSelector() {
  if (myChannels.length === 0) {
    channelSelect.innerHTML = '<option value="">No channels yet - create one!</option>';
    startBroadcastBtn.disabled = true;
    return;
  }

  channelSelect.innerHTML = '<option value="">Select a channel...</option>' +
    myChannels.map(ch => `<option value="${ch.id}">${ch.name} ${ch.isLive ? '(LIVE)' : ''}</option>`).join('');

  startBroadcastBtn.disabled = !selectedChannelId;
}

channelSelect.addEventListener('change', () => {
  selectedChannelId = channelSelect.value;
  const channel = myChannels.find(c => c.id === selectedChannelId);

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
    const res = await apiFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, color })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    channelStatus.textContent = 'Channel created!';
    channelStatus.style.color = '#00d9a5';

    setTimeout(() => {
      channelForm.classList.add('hidden');
      createChannelBtn.classList.remove('hidden');
      channelNameInput.value = '';
      channelDescInput.value = '';
      channelStatus.textContent = '';
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

startBroadcastBtn.addEventListener('click', async () => {
  if (!selectedChannelId) {
    broadcastStatus.textContent = 'Please select a channel first';
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('Got stream');

    audioContext = new AudioContext({ sampleRate: 44100 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    mediaStreamDestination = audioContext.createMediaStreamDestination();
    source.connect(mediaStreamDestination);

    const mediaRecorder = new MediaRecorder(mediaStreamDestination.stream, { mimeType: 'audio/webm;codecs=opus' });
    recordedBuffers = [];

    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (isRecording) {
        const data = e.inputBuffer.getChannelData(0);
        recordedBuffers.push(new Float32Array(data));
      }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    if (!socket.connected) {
      broadcastStatus.textContent = 'Socket not connected. Please refresh.';
      return;
    }

    socket.emit('join-channel', { channelId: selectedChannelId, role: 'broadcaster' });

    setTimeout(() => {
      socket.emit('broadcaster-ready', { channelId: selectedChannelId });
    }, 100);

    startBroadcastBtn.disabled = true;
    stopBroadcastBtn.disabled = false;
    startRecordingBtn.disabled = !selectedChannelId;
    broadcastStatus.textContent = 'Broadcasting...';
    liveIndicator.textContent = '● Live';
    liveIndicator.className = 'indicator live';
    isLive = true;
  } catch (e) {
    console.error('Error:', e);
    broadcastStatus.textContent = 'Error: ' + e.message;
  }
});

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
});

startRecordingBtn.addEventListener('click', () => {
  if (!audioContext) { alert('Start broadcast first'); return; }
  recordedBuffers = [];
  isRecording = true;
  startRecordingBtn.disabled = true;
  stopRecordingBtn.disabled = false;
  recordingStatus.textContent = 'Recording...';
});

stopRecordingBtn.addEventListener('click', async () => {
  if (!isRecording) return;
  isRecording = false;
  stopRecordingBtn.disabled = true;
  recordingStatus.textContent = 'Processing...';

  if (recordedBuffers.length === 0) {
    recordingStatus.textContent = 'No audio data';
    return;
  }

  const allData = new Float32Array(recordedBuffers.reduce((sum, b) => sum + b.length, 0));
  let offset = 0;
  recordedBuffers.forEach(buf => {
    allData.set(buf, offset);
    offset += buf.length;
  });

  const wavBlob = encodeWAV([allData], audioContext.sampleRate);
  const arrayBuffer = await wavBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  console.log('WAV size:', uint8Array.length);

  try {
    const response = await apiFetch('/api/recordings/upload', {
      method: 'POST',
      headers: { 
        'Content-Type': 'audio/wav',
        'X-Channel-Id': selectedChannelId
      },
      body: uint8Array
    });
    const result = await response.json();
    recordingStatus.textContent = 'Saved!';
    loadRecordings();
  } catch (e) {
    console.error(e);
    recordingStatus.textContent = 'Error: ' + e.message;
  }

  recordedBuffers = [];
});

async function loadRecordings() {
  try {
    const res = await apiFetch('/api/recordings');
    renderRecordings(await res.json());
  } catch (e) { console.error(e); }
}

function renderRecordings(recordings) {
  if (!recordings || recordings.length === 0) {
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
    listenerCountEl.textContent = `Listeners: ${data.count}`;
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
