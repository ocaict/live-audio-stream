// socket is declared in index.html
const API_URL = window.API_URL || ''; // Configurable API URL for separate hosting
let isLive = false;
let isRecording = false;
let mediaStream = null;
let peerConnections = {};
let pendingIceCandidates = {};

const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

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
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
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
    if (data.authenticated) showDashboard();
  } catch (e) { console.error('Auth failed:', e); }
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
  } catch (e) { loginError.textContent = e.message; }
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  loadRecordings();
}

function logout() {
  apiFetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  login(document.getElementById('username').value, document.getElementById('password').value);
});
logoutBtn.addEventListener('click', logout);

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
    
    socket.emit('broadcaster-ready');
    startBroadcastBtn.disabled = true;
    stopBroadcastBtn.disabled = false;
    broadcastStatus.textContent = 'Broadcasting...';
  } catch (e) {
    console.error('Error:', e);
    broadcastStatus.textContent = 'Error: ' + e.message;
  }
});

stopBroadcastBtn.addEventListener('click', () => {
  if (isRecording) { alert('Stop recording first'); return; }
  socket.emit('stop-broadcasting');
  
  Object.values(peerConnections).forEach(pc => { try { pc.close(); } catch(e) {} });
  peerConnections = {};
  
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  
  startBroadcastBtn.disabled = false;
  stopBroadcastBtn.disabled = true;
  startRecordingBtn.disabled = true;
  broadcastStatus.textContent = 'Broadcast stopped';
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
      headers: { 'Content-Type': 'application/octet-stream' },
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
  startRecordingBtn.textContent = 'Start Recording';
});

async function loadRecordings() {
  try {
    const res = await apiFetch('/api/recordings');
    renderRecordings(await res.json());
  } catch (e) { console.error(e); }
}

function renderRecordings(recordings) {
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
    console.log('Blob:', blob.size, blob.type);
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
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[socketId] = pc;
  pendingIceCandidates[socketId] = [];

  if (mediaStreamDestination) {
    pc.addTrack(mediaStreamDestination.stream.getAudioTracks()[0], mediaStreamDestination.stream);
  }

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('ice-candidate', { target: socketId, candidate: e.candidate });
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { socketId, sdp: answer.sdp });
  } catch (e) { console.error(e); }
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

socket.on('live-status', s => {
  isLive = s.isLive;
  liveIndicator.textContent = s.isLive ? '● Live' : '● Offline';
  liveIndicator.className = 'indicator ' + (s.isLive ? 'live' : 'offline');
  broadcastStatus.textContent = s.isLive ? 'Broadcasting' : 'Stopped';
  startRecordingBtn.disabled = !s.isLive;
});
socket.on('listener-count', c => listenerCountEl.textContent = `Listeners: ${c}`);
socket.on('error', m => alert(m));

checkAuth();
