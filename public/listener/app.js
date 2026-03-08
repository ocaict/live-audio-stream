const socket = io(window.SERVER_URL || '');
let peerConnection = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 50;
let reconnectDelay = 2000;
let offlineAudio = null;
let latestRecordingUrl = null;

const State = {
  intent: localStorage.getItem('isListeningIntent') === 'true',
  channelId: localStorage.getItem('lastChannelId'),
  volume: parseFloat(localStorage.getItem('userVolume') || '0.8'),
  isStreaming: false,
  isReconnecting: false,
  channels: [],

  commit(key, value) {
    this[key] = value;
    if (key === 'intent') localStorage.setItem('isListeningIntent', value);
    if (key === 'channelId') localStorage.setItem('lastChannelId', value);
    if (key === 'volume') {
      localStorage.setItem('userVolume', value);
      if (audioPlayer) audioPlayer.volume = value;
    }
    console.log(`[State Change] ${key} ->`, value);
    refreshUI();
  }
};

let rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

async function loadRTCConfig() {
  try {
    const res = await fetch('/api/status/rtc-config');
    const data = await res.json();
    if (data.iceServers) {
      rtcConfig = data;
      console.log('[RTC] ICE Servers loaded from server');
    }
  } catch (e) {
    console.error('[RTC] Failed to load config, using fallback:', e);
  }
}

const listenBtn = document.getElementById('listen-btn');
const statusText = document.getElementById('status-text');
const listenerCountEl = document.getElementById('listener-count');
const liveIndicator = document.getElementById('live-indicator');
const audioPlayer = document.getElementById('audio-player');
const pulseRing = document.querySelector('.pulse-ring');
const channelSelect = document.getElementById('channel-select');
const volumeSlider = document.getElementById('volume-slider');
const volumeIcon = document.getElementById('volume-icon');

// Chat UI
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatUsernameInput = document.getElementById('chat-username');
const sendBtn = document.getElementById('send-btn');

// Load saved username
if (chatUsernameInput) {
  chatUsernameInput.value = localStorage.getItem('chatUsername') || '';
}

// Initialize volume
if (volumeSlider) {
  volumeSlider.value = State.volume;
}
if (audioPlayer) {
  audioPlayer.volume = State.volume;
}

function updateStatus(message, type = 'normal') {
  console.log(`[Status] ${message} (${type})`);
  statusText.textContent = message;
  statusText.dataset.type = type;
}

if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    State.commit('volume', vol);
    if (audioPlayer) {
      audioPlayer.volume = vol;
      audioPlayer.muted = false;
    }
    updateVolumeIcon(vol);
  });
}

if (volumeIcon) {
  volumeIcon.addEventListener('click', () => {
    if (audioPlayer.muted) {
      audioPlayer.muted = false;
      volumeSlider.value = State.volume;
      updateVolumeIcon(State.volume);
    } else {
      audioPlayer.muted = true;
      volumeSlider.value = 0;
      updateVolumeIcon(0);
    }
  });
}

function updateVolumeIcon(vol) {
  if (vol === 0 || audioPlayer.muted) {
    volumeIcon.setAttribute('data-lucide', 'volume-x');
  } else if (vol < 0.5) {
    volumeIcon.setAttribute('data-lucide', 'volume-1');
  } else {
    volumeIcon.setAttribute('data-lucide', 'volume-2');
  }
  lucide.createIcons();
}

function refreshUI() {
  const selectedOption = channelSelect.options[channelSelect.selectedIndex];
  const uiLive = selectedOption?.dataset?.live === 'true';

  const statusLabel = liveIndicator.querySelector('.status-label');
  if (statusLabel) {
    statusLabel.textContent = uiLive ? 'Live' : 'Offline';
  }
  liveIndicator.className = 'indicator ' + (uiLive ? 'live' : 'offline');

  const btnIcon = listenBtn.querySelector('.btn-icon');
  const btnText = listenBtn.querySelector('.text');

  if (State.intent) {
    listenBtn.classList.add('listening');
    if (btnText) btnText.textContent = 'Stop';
    if (btnIcon) {
      btnIcon.setAttribute('data-lucide', 'square');
      lucide.createIcons();
    }
  } else {
    listenBtn.classList.remove('listening');
    if (btnText) btnText.textContent = 'Listen Live';
    if (btnIcon) {
      btnIcon.setAttribute('data-lucide', 'play');
      lucide.createIcons();
    }
  }

  if (!State.intent) {
    updateStatus(uiLive ? 'Broadcast is live - Click to listen' : 'Select a channel to listen');
    pulseRing.classList.remove('active');
  } else {
    if (State.isStreaming) {
      updateStatus('Listening live!', 'success');
      pulseRing.classList.add('active');
    } else {
      const channel = State.channels.find(c => String(c.id) === String(State.channelId));
      if (!channel || !channel.isLive) {
        updateStatus('Broadcast ended. Waiting for restart...', 'connecting');
      } else {
        updateStatus('Connecting to stream...', 'connecting');
      }
      pulseRing.classList.remove('active');
    }
  }
}

async function loadChannels() {
  try {
    const res = await fetch('/api/channels');
    if (!res.ok) {
      throw new Error(`Failed to load channels: ${res.status}`);
    }
    const data = await res.json();
    State.channels = Array.isArray(data) ? data : [];
    renderChannelSelector();
  } catch (e) {
    console.error('Failed to load channels:', e);
    State.channels = [];
    channelSelect.innerHTML = '<option value="">Failed to load channels</option>';
  }
}

function renderChannelSelector() {
  if (!Array.isArray(State.channels)) {
    State.channels = [];
  }
  const savedId = channelSelect.value || State.channelId;

  if (State.channels.length === 0) {
    channelSelect.innerHTML = '<option value="">No channels available</option>';
    listenBtn.disabled = true;
    return;
  }

  channelSelect.innerHTML = State.channels.map(ch =>
    `<option value="${ch.id}" ${String(ch.id) === String(savedId) ? 'selected' : ''} ${ch.isLive ? 'data-live="true"' : ''}>${ch.name} ${ch.isLive ? '● LIVE' : ''}</option>`
  ).join('');

  if (savedId) channelSelect.value = savedId;
  listenBtn.disabled = false;
  refreshUI();
}

async function startListening() {
  if (State.intent) {
    stopListening();
    return;
  }

  const cid = channelSelect.value;
  if (!cid) {
    updateStatus('Please select a channel', 'error');
    return;
  }

  console.log('>>> startListening - channel:', cid);
  State.commit('channelId', cid);
  State.commit('intent', true);
  connectToBroadcast();
}

async function tryOfflinePlayback() {
  if (!State.channelId) {
    updateStatus('No channel selected', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/recordings/latest/${State.channelId}`);

    if (!res.ok) {
      if (res.status === 404) {
        updateStatus('Broadcast ended. No recording available.', 'error');
      } else {
        updateStatus('Server error. Retrying...', 'connecting');
        setTimeout(tryOfflinePlayback, 2000);
      }
      refreshUI();
      return;
    }
    const recording = await res.json();

    if (!recording || !recording.id) {
      updateStatus('Broadcast ended. No recording available.', 'error');
      refreshUI();
      return;
    }

    latestRecordingUrl = `/api/recordings/${recording.id}/stream`;

    audioPlayer.pause();
    audioPlayer.srcObject = null;
    audioPlayer.removeAttribute('src');
    audioPlayer.load();

    audioPlayer.volume = State.volume;
    audioPlayer.src = latestRecordingUrl;
    audioPlayer.loop = true;

    const playPromise = audioPlayer.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        audioPlayer.classList.add('show');
        State.commit('isStreaming', true);
        updateStatus('Playing latest recording (offline)', 'success');
        pulseRing.classList.add('active');
      }).catch(e => {
        console.error('Play promise error:', e);
        updateStatus('Click to play recording', 'error');
      });
    }
  } catch (e) {
    console.error('Failed to load offline recording:', e);
    updateStatus('Broadcast ended. Waiting for restart...', 'connecting');
  }
}

let isConnecting = false;

async function connectToBroadcast() {
  if (isConnecting) {
    console.log('>>> connectToBroadcast skipped - already connecting');
    return;
  }

  if (!State.channelId || !State.intent) {
    console.log('>>> connectToBroadcast skipped - no channelId or no intent');
    return;
  }

  if (!socket.connected) {
    console.log('>>> Socket not connected, waiting...');
    return;
  }

  isConnecting = true;
  console.log('>>> connectToBroadcast - channelId:', State.channelId, 'intent:', State.intent);
  socket.emit('join-channel', { channelId: State.channelId, role: 'listener' });
  console.log('>>> join-channel emitted');

  try {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (!channel) {
      console.log('Channel not found in local state, refreshing...');
      await loadChannels();
      const refreshedChannel = State.channels.find(c => String(c.id) === String(State.channelId));
      if (!refreshedChannel || !refreshedChannel.isLive) {
        console.log('Target offline, trying offline playback...');
        await tryOfflinePlayback();
        return;
      }
    } else if (!channel.isLive) {
      console.log('Target offline, trying offline playback...');
      await tryOfflinePlayback();
      return;
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.ontrack = (event) => {
      console.log('Audio track established');
      if (event.streams[0]) {
        // Buffering hint: 500ms jitter buffer for smoother radio experience
        try {
          const receivers = peerConnection.getReceivers();
          const audioReceiver = receivers.find(r => r.track?.kind === 'audio');
          if (audioReceiver && 'playoutDelayHint' in audioReceiver) {
            audioReceiver.playoutDelayHint = 0.5;
            console.log('[RTC] Buffering enabled: 500ms delay hint set.');
          }
        } catch (e) { console.warn('[RTC] PlayoutDelayHint not supported:', e); }

        audioPlayer.srcObject = event.streams[0];
        audioPlayer.volume = State.volume;
        audioPlayer.play().then(() => {
          State.commit('isStreaming', true);
          State.commit('isReconnecting', false);
          reconnectAttempts = 0;
          initVisualizer(event.streams[0]);
        }).catch(e => {
          console.warn('Autoplay blocked');
          State.commit('isStreaming', true);
          updateStatus('⚠️ Click anywhere to unmute stream!', 'error');
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      handleIceStateChange(peerConnection.iceConnectionState);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate, channelId: State.channelId });
      }
    };

    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    socket.emit('offer', { sdp: offer.sdp, socketId: socket.id, channelId: State.channelId });
    socket.emit('join-as-listener', { channelId: State.channelId });

  } catch (e) {
    console.error('Connection error:', e);
    if (State.intent) {
      attemptReconnect();
    }
  } finally {
    isConnecting = false;
  }
}

function handleIceStateChange(state) {
  const statesToReconnect = ['failed', 'disconnected', 'closed'];

  if (statesToReconnect.includes(state) && State.intent && !State.isReconnecting) {
    console.log('ICE connection state:', state, '- attempting reconnect');
    State.commit('isStreaming', false);
    attemptReconnect();
  }
}

function attemptReconnect() {
  console.log('>>> attemptReconnect called, intent:', State.intent, 'channelId:', State.channelId, 'attempts:', reconnectAttempts);
  if (State.isReconnecting || reconnectAttempts >= maxReconnectAttempts) {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      updateStatus('Connection lost. Please reconnect manually.', 'error');
      stopListening();
    }
    return;
  }

  State.commit('isReconnecting', true);
  reconnectAttempts++;
  const delay = reconnectDelay * Math.pow(1.5, reconnectAttempts - 1);

  updateStatus(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`, 'connecting');

  setTimeout(async () => {
    if (!State.intent || !State.channelId) {
      console.log('Reconnection aborted: intent cleared');
      State.commit('isReconnecting', false);
      return;
    }

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (!channel || !channel.isLive) {
      console.log('Channel not live, trying offline playback...');
      State.commit('isReconnecting', false);
      tryOfflinePlayback();
      return;
    }

    await connectToBroadcast();
  }, delay);
}

function stopListening() {
  console.log('Stopping...');
  State.commit('intent', false);
  State.commit('isStreaming', false);
  State.commit('isReconnecting', false);
  stopVisualizer();

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  socket.emit('leave-listener');
  audioPlayer.srcObject = null;
  audioPlayer.src = '';
  audioPlayer.pause();
  audioPlayer.loop = false;
  latestRecordingUrl = null;
}

channelSelect.addEventListener('change', (e) => {
  if (e.isTrusted && State.intent) {
    stopListening();
  }
  refreshUI();
});

listenBtn.addEventListener('click', startListening);

document.addEventListener('click', () => {
  if (State.intent && audioPlayer.paused && audioPlayer.srcObject) {
    console.log('User interaction: Attempting audio resume...');
    audioPlayer.play()
      .then(() => {
        State.commit('isStreaming', true);
      })
      .catch(e => console.error('Unlock failed:', e));
  }
}, { once: false });

socket.on('connect', async () => {
  await loadChannels();

  if (State.intent && State.channelId) {
    socket.emit('join-channel', { channelId: State.channelId, role: 'listener' });

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (channel && channel.isLive) {
      connectToBroadcast();
    } else {
      refreshUI();
    }
  } else {
    refreshUI();
  }
});

socket.on('disconnect', () => {
  console.log('>>> Socket disconnected');
  if (State.intent) {
    State.commit('isStreaming', false);
    updateStatus('Connection lost. Syncing...', 'connecting');
  }
});

socket.on('connect_error', (error) => {
  console.error('>>> Socket connection error:', error);
  if (State.intent) {
    updateStatus('Server unavailable. Retrying connection...', 'error');
  }
});

socket.on('channels-list', (channelsData) => {
  State.channels = Array.isArray(channelsData) ? channelsData : [];
  renderChannelSelector();
});

let lastChannelLiveEvent = null;

socket.on('channel-live', (data) => {
  const eventKey = `${data.channelId}-${data.isLive}`;
  if (lastChannelLiveEvent === eventKey) {
    return;
  }
  lastChannelLiveEvent = eventKey;
  setTimeout(() => { lastChannelLiveEvent = null; }, 500);

  if (!Array.isArray(State.channels)) {
    State.channels = [];
  }
  const ch = State.channels.find(c => String(c.id) === String(data.channelId));
  if (ch) {
    ch.isLive = data.isLive;
  } else {
    console.log('>>> Channel not found in local state, loading...');
    loadChannels();
  }

  if (String(State.channelId) === String(data.channelId) && State.intent) {
    console.log('>>> Matching channel, intent:', State.intent, 'isLive:', data.isLive, 'isStreaming:', State.isStreaming);
    if (data.isLive) {
      console.log('>>> Broadcast now live. Connecting to live stream...');
      audioPlayer.pause();
      audioPlayer.src = '';
      audioPlayer.loop = false;
      latestRecordingUrl = null;
      setTimeout(() => {
        if (State.intent) {
          connectToBroadcast();
        }
      }, 100);
    } else if (!data.isLive) {
      console.log('>>> Broadcast stopped.');
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      State.commit('isStreaming', false);
      tryOfflinePlayback();
    }
  }
  renderChannelSelector();
});

socket.on('listener-count', (data) => {
  if (String(State.channelId) === String(data.channelId)) {
    // Keep icons, update text
    const icon = listenerCountEl.querySelector('i, svg');
    listenerCountEl.innerHTML = '';
    if (icon) listenerCountEl.appendChild(icon);
    listenerCountEl.appendChild(document.createTextNode(` ${data.count}`));
  }

  const channel = State.channels.find(c => c.id === data.channelId);
  if (channel) {
    channel.listenerCount = data.count;
  }
});

socket.on('offer', async (data) => {
  console.log('Got offer');
  if (!peerConnection || !State.channelId) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { socketId: data.socketId, sdp: answer.sdp, channelId: State.channelId });
  } catch (e) { console.error('Offer error:', e); }
});

socket.on('answer', async (data) => {
  console.log('Got answer');
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
    updateStatus('Listening live!', 'success');
    pulseRing.classList.add('active');
  } catch (e) { console.error('Answer error:', e); }
});

socket.on('ice-candidate', async (data) => {
  if (!peerConnection) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) { console.error('ICE error:', e); }
});

socket.on('broadcast-ended', () => {
  if (State.intent) {
    console.log('Server signal: broadcast ended');
    updateStatus('Broadcast ended. Waiting for restart...', 'connecting');
    pulseRing.classList.remove('active');
    State.commit('isStreaming', false);
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  }
});

socket.on('no-broadcast', () => {
  if (State.intent) {
    console.log('Server signal: no broadcast');
    updateStatus('Broadcaster not ready. Waiting...', 'connecting');
    State.commit('isStreaming', false);
    if (!State.isReconnecting) {
      attemptReconnect();
    }
  }
});

/* Interactive Chat Logic */
socket.on('chat-history', (data) => {
  if (String(data.channelId) !== String(State.channelId)) return;
  chatMessages.innerHTML = '';
  if (data.messages.length === 0) {
    chatMessages.innerHTML = '<div class="chat-placeholder">Welcome! Join the conversation below.</div>';
  } else {
    data.messages.forEach(msg => appendMessage(msg));
  }
});

socket.on('new-message', (msg) => {
  if (String(msg.channel_id) !== String(State.channelId)) return;

  // Remove placeholder if it exists
  const placeholder = chatMessages.querySelector('.chat-placeholder');
  if (placeholder) placeholder.remove();

  appendMessage(msg);
});

function appendMessage(msg) {
  const currentUsername = chatUsernameInput.value.trim() || 'Anonymous';
  const isOwn = msg.username === currentUsername;

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
  const username = chatUsernameInput.value.trim() || 'Anonymous';

  if (!content || !State.channelId) return;

  // Persist username
  localStorage.setItem('chatUsername', username);

  socket.emit('send-message', {
    channelId: State.channelId,
    content,
    username
  });

  chatInput.value = '';
});

/* Visualizer Logic */
let visualizerContext = null;
let animationId = null;

function initVisualizer(stream) {
  if (!stream) return;

  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');

  // Set canvas size
  canvas.width = 220;
  canvas.height = 220;

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;

  source.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    animationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 60;

    ctx.strokeStyle = '#00f2ea';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i] / 255;
      const barHeight = value * 40;

      const angle = (i * 2 * Math.PI) / bufferLength;
      const x1 = centerX + Math.cos(angle) * radius;
      const y1 = centerY + Math.sin(angle) * radius;
      const x2 = centerX + Math.cos(angle) * (radius + barHeight);
      const y2 = centerY + Math.sin(angle) * (radius + barHeight);

      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  draw();
}

function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

loadChannels();
loadRTCConfig();

// =============================================
// AUTO-DJ LISTENER: PCM Audio Decoder
// =============================================
let djAudioCtx = null;
let djNextStartTime = 0;
let djIsActive = false;

const DJ_SAMPLE_RATE = 44100;
const DJ_CHANNELS = 1;

function initDJAudio() {
  if (!djAudioCtx) {
    djAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: DJ_SAMPLE_RATE });
    djNextStartTime = djAudioCtx.currentTime;
  }
  if (djAudioCtx.state === 'suspended') {
    djAudioCtx.resume();
  }
}

function scheduleChunk(rawBuffer) {
  if (!djAudioCtx) return;

  // Convert raw bytes (PCM s16le) -> Float32 samples
  const int16 = new Int16Array(rawBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0; // Normalize to [-1, 1]
  }

  const audioBuffer = djAudioCtx.createBuffer(DJ_CHANNELS, float32.length, DJ_SAMPLE_RATE);
  audioBuffer.copyToChannel(float32, 0);

  const source = djAudioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(djAudioCtx.destination);

  // Schedule it gaplessly — no silence between chunks
  const duration = audioBuffer.duration;
  const currentTime = djAudioCtx.currentTime;
  const startAt = Math.max(djNextStartTime, currentTime + 0.05);
  source.start(startAt);
  djNextStartTime = startAt + duration;
}

function stopDJAudio() {
  if (djAudioCtx) {
    djAudioCtx.close();
    djAudioCtx = null;
    djNextStartTime = 0;
  }
  djIsActive = false;
}

// ── Auto-DJ socket events ──────────────────────────
socket.on('autodj-started', ({ channelId }) => {
  if (channelId !== State.channelId) return;
  console.log('[AutoDJ] Auto-DJ started on this channel');
  djIsActive = true;
  initDJAudio();
  updateStatus('📻 Auto-DJ is live — enjoy the music!', 'live');
  // Pulse the visualizer ring
  if (pulseRing) pulseRing.style.display = 'block';
});

socket.on('dj-audio-chunk', (data) => {
  if (!djIsActive) return;
  try {
    // data arrives as ArrayBuffer or Buffer
    const buffer = data instanceof ArrayBuffer ? data : data.buffer || data;
    scheduleChunk(buffer);
  } catch (e) {
    console.error('[AutoDJ] Chunk decode error:', e);
  }
});

socket.on('autodj-track-changed', (meta) => {
  if (meta.channelId !== State.channelId) return;
  console.log(`[AutoDJ] Now playing: "${meta.title}" (${meta.category})`);

  // Update the UI status bar with the current track
  const nowPlayingEl = document.getElementById('now-playing-bar');
  if (nowPlayingEl) {
    const categoryEmoji = { music: '🎵', show: '🎙️', jingle: '✨', ad: '🗣️' };
    const emoji = categoryEmoji[meta.category] || '🎵';
    nowPlayingEl.textContent = `${emoji} Now Playing: ${meta.title}`;
    nowPlayingEl.style.display = 'block';
  }
  updateStatus(`📻 Auto-DJ: ${meta.title}`, 'live');
});

socket.on('autodj-stopped', ({ channelId, reason }) => {
  if (channelId !== State.channelId) return;
  console.log('[AutoDJ] Stopped, reason:', reason);
  stopDJAudio();
  djIsActive = false;

  const nowPlayingEl = document.getElementById('now-playing-bar');
  if (nowPlayingEl) nowPlayingEl.style.display = 'none';

  if (reason === 'broadcaster_took_over') {
    updateStatus('🎙️ Live broadcast resumed', 'live');
  } else {
    updateStatus('Auto-DJ ended. Waiting for broadcast...', 'normal');
    if (pulseRing) pulseRing.style.display = 'none';
  }
});

socket.on('autodj-no-media', ({ channelId }) => {
  if (channelId !== State.channelId) return;
  updateStatus('No media in library. Upload tracks to start Auto-DJ.', 'offline');
});

