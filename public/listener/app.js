const socket = io(window.SERVER_URL || '');
let peerConnection = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 50;
let reconnectDelay = 2000;
let offlineAudio = null;
let latestRecordingUrl = null;

// Unified Playout Engine
let audioCtx = null;
let masterGain = null;
let rtcSource = null;
let rtcGain = null;
let currentActiveSource = null; // 'rtc', 'dj'
const SOURCE_FADE_MS = 1000; // 1 second crossfade between sources

// Auto-DJ State
let djIsActive = false;
const trackStates = new Map();
let currentTrackId = null;

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
      if (audioPlayer) audioPlayer.volume = value; // Fallback
      if (masterGain) masterGain.gain.setTargetAtTime(value, audioCtx.currentTime, 0.1);
    }
    console.log(`[State Change] ${key} ->`, value);
    refreshUI();
  }
};

function initMasterAudio() {
  if (!State.intent) return; // Don't touch audio until user says so
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(State.volume, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    rtcGain = audioCtx.createGain();
    rtcGain.connect(masterGain);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.warn('[Audio] Resume failed (Autoplay):', e));
  }
}

function transitionToSource(type) {
  if (!audioCtx || currentActiveSource === type) return;
  const currTime = audioCtx.currentTime;
  const fadeTime = SOURCE_FADE_MS / 1000;

  console.log(`[Crossfade] Transitioning ${currentActiveSource} -> ${type}`);

  // Fade out current active
  if (currentActiveSource === 'rtc' && rtcGain) {
    rtcGain.gain.setTargetAtTime(0, currTime, fadeTime / 3);
  }
  // (Auto-DJ tracks fade themselves out when trackId changes)

  // Fade in new active
  if (type === 'rtc' && rtcGain) {
    rtcGain.gain.setTargetAtTime(1, currTime, fadeTime / 3);
  } else if (type === 'dj') {
    // DJ tracks handle their own gain nodes that connect to masterGain.
    // We just ensure the others are muted.
    if (rtcGain) rtcGain.gain.setTargetAtTime(0, currTime, fadeTime / 3);
  }

  currentActiveSource = type;
}

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

// Tune-In Overlay Elements
const tuneInOverlay = document.getElementById('tune-in-overlay');
const tuneInBtn = document.getElementById('tune-in-btn');

// Call-In DOM elements
const callInControls = document.getElementById('call-in-controls');
const requestMicBtn = document.getElementById('request-mic-btn');
const callStatusMsg = document.getElementById('call-status-msg');

let callState = 'idle'; // 'idle', 'requesting', 'accepted', 'connected'
let callPC = null;
let callStream = null;

const sendBtn = document.getElementById('send-btn');

// Schedule Overlay DOM
const viewScheduleBtn = document.getElementById('view-schedule-btn');
const closeScheduleBtn = document.getElementById('close-schedule-btn');
const scheduleOverlay = document.getElementById('schedule-overlay');
const scheduleContainer = document.getElementById('schedule-container');

// Now Playing Card DOM
const nowPlayingCard = document.getElementById('now-playing-card');
const npcTitle = document.getElementById('npc-title');
const npcCategory = document.getElementById('npc-category');
const npcNextTitle = document.getElementById('npc-next-title'); // Added this
const npcIcon = document.querySelector('.npc-icon i');

// Chat UI
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatUsernameInput = document.getElementById('chat-username');
const chatPanel = document.querySelector('.chat-panel');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatBadge = document.getElementById('chat-badge');

// Library Overlay DOM
const viewLibraryBtn = document.getElementById('view-library-btn');
const closeLibraryBtn = document.getElementById('close-library-btn');
const libraryOverlay = document.getElementById('library-overlay');
const libraryContainer = document.getElementById('library-container');
const archiveAudioPlayer = document.getElementById('archive-audio-player');
const libraryPlayerContainer = document.getElementById('library-player-container');
const lpTitle = document.getElementById('lp-title');
const librarySearch = document.getElementById('library-search');

let allRecordings = []; // For filtering

// Load saved username
if (chatUsernameInput) {
  let savedName = localStorage.getItem('chatUsername');
  if (!savedName) {
    savedName = `Anonymous-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem('chatUsername', savedName);
  }
  chatUsernameInput.value = savedName;
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

// Logic for Premium "Tune In" Overlay
if (tuneInBtn) {
  tuneInBtn.addEventListener('click', () => {
    console.log('[TuneIn] User initiated playback');

    // 1. Hide the overlay with the fade transition
    tuneInOverlay.classList.add('hidden');

    // 2. Trigger audio start logic
    initMasterAudio();

    if (!State.intent) {
      startListening();
    } else {
      connectToBroadcast();
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

  // Show/Hide Call-In controls based on live status
  if (uiLive && State.intent && State.isStreaming) {
    if (callInControls) callInControls.classList.remove('hidden');
  } else {
    if (callInControls) callInControls.classList.add('hidden');
    if (callState !== 'idle') resetCallState();
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
  // If moving to live, pause archive
  if (archiveAudioPlayer) archiveAudioPlayer.pause();
  if (libraryPlayerContainer) libraryPlayerContainer.classList.add('hidden');
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

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
    if (!channel || !channel.isLive) {
      console.log('Target offline, waiting for Live or Auto-DJ...');
      updateStatus('Station is currently on standby', 'connecting');
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

        initMasterAudio();
        // Pipe WebRTC into AudioContext for Global Crossfade
        if (rtcSource) rtcSource.disconnect();
        rtcSource = audioCtx.createMediaStreamSource(event.streams[0]);
        rtcSource.connect(rtcGain);
        transitionToSource('rtc');

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

  updateStatus(`Reconnecting... (${reconnectAttempts} / ${maxReconnectAttempts})`, 'connecting');

  setTimeout(async () => {
    if (!State.intent || !State.channelId) {
      console.log('Reconnection aborted: intent cleared');
      State.commit('isReconnecting', false);
      return;
    }

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (!channel || !channel.isLive) {
      console.log('Channel not live, staying on standby...');
      State.commit('isReconnecting', false);
      refreshUI();
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
  const eventKey = `${data.channelId} -${data.isLive} `;
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
      console.log('>>> Broadcast now live. Stopping Auto-DJ and connecting to live stream...');
      // Stop Auto-DJ immediately so there's no double-audio
      if (djIsActive) {
        stopDJAudio();
        const nowPlayingEl = document.getElementById('now-playing-bar');
        if (nowPlayingEl) nowPlayingEl.style.display = 'none';
      }
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
      updateStatus('Broadcast ended. Station returning to feed...', 'connecting');
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
    listenerCountEl.appendChild(document.createTextNode(` ${data.count} `));
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

socket.on('station-offline-info', (data) => {
  if (String(data.channelId) !== String(State.channelId)) return;

  if (data.nextShow) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const isToday = data.nextShow.dayOfWeek === now.getUTCDay();
    const dayName = isToday ? 'Today' : days[data.nextShow.dayOfWeek];
    const timeStr = data.nextShow.startTime.substring(0, 5);

    updateStatus(`Next show ${dayName} at ${timeStr}: ${data.nextShow.title}`, 'connecting');
  } else {
    updateStatus('Station is currently on standby', 'connecting');
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

socket.on('message-deleted', (data) => {
  if (data.channelId !== State.channelId) return;
  const msgEl = document.querySelector(`.message-item[data-id="${data.messageId}"]`);
  if (msgEl) {
    msgEl.classList.add('deleted');
    setTimeout(() => msgEl.remove(), 300);
  }
});

socket.on('chat-cleared', (data) => {
  if (data.channelId !== State.channelId) return;
  chatMessages.innerHTML = '<div class="chat-placeholder">No messages yet. Start the conversation!</div>';
});

function appendMessage(msg) {
  const currentUsername = chatUsernameInput.value.trim() || 'Anonymous';
  const isOwn = msg.username === currentUsername;
  const isAdmin = msg.is_admin === true;
  const isSystem = msg.is_system === true;

  const div = document.createElement('div');
  div.className = `message-item ${isOwn ? 'own' : ''} ${isAdmin ? 'is-admin' : ''} ${isSystem ? 'is-system' : ''}`;
  div.dataset.id = msg.id;

  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.innerHTML = `
    <div class="message-meta">
      ${isAdmin ? '<span class="admin-badge">Broadcaster</span>' : ''}
      <span>${msg.username} • ${time}</span>
    </div>
    <div class="chat-bubble">${msg.content}</div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Badge logic: if drawer is closed and message is not mine
  if (chatPanel && !chatPanel.classList.contains('open') && !isOwn && chatBadge) {
    chatBadge.classList.remove('hidden');
  }
}

if (chatToggleBtn) {
  chatToggleBtn.addEventListener('click', () => {
    chatPanel.classList.add('open');
    if (chatBadge) chatBadge.classList.add('hidden');
  });
}

if (closeChatBtn) {
  closeChatBtn.addEventListener('click', () => {
    chatPanel.classList.remove('open');
  });
}

let chatCooldown = false;
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (chatCooldown) return;

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

  // Trigger cooldown
  chatCooldown = true;
  const submitBtn = chatForm.querySelector('.send-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('cooldown');
  }

  setTimeout(() => {
    chatCooldown = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('cooldown');
    }
  }, 2000);
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
// AUTO-DJ LISTENER: PCM Audio Decoder with Crossfading
// =============================================
const DJ_SAMPLE_RATE = 44100;
const DJ_CHANNELS = 1;
const CROSSFADE_DURATION = 3.0; // 3 seconds overlap

function initDJAudio() {
  if (!State.intent) return;
  initMasterAudio();
  djIsActive = true;
  transitionToSource('dj');
}

function scheduleChunk(rawBuffer, trackId) {
  if (!audioCtx || !State.intent) return;

  // Initialize track state if this is a new track
  if (!trackStates.has(trackId)) {
    const gainNode = audioCtx.createGain();
    gainNode.connect(masterGain);

    // Start silent, we will fade in
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    trackStates.set(trackId, {
      nextStartTime: audioCtx.currentTime + 0.1, // Slight buffer
      gainNode: gainNode,
      fadingIn: false
    });

    // If there is an existing track playing, tell it to fade out
    if (currentTrackId && currentTrackId !== trackId && trackStates.has(currentTrackId)) {
      const oldState = trackStates.get(currentTrackId);
      const currTime = audioCtx.currentTime;

      // Stop previous track's fade-in if it was still happening
      oldState.gainNode.gain.cancelScheduledValues(currTime);
      oldState.gainNode.gain.setValueAtTime(oldState.gainNode.gain.value, currTime);

      // Fade out over X seconds
      oldState.gainNode.gain.linearRampToValueAtTime(0, currTime + CROSSFADE_DURATION);

      // Clean up the old track state memory after fade completes
      const toDelete = currentTrackId;
      setTimeout(() => {
        trackStates.delete(toDelete);
      }, (CROSSFADE_DURATION + 1) * 1000);
    }

    currentTrackId = trackId;
  }

  const state = trackStates.get(trackId);

  // Crossfade Trigger: Fade in the new track
  if (!state.fadingIn) {
    const currTime = audioCtx.currentTime;
    state.gainNode.gain.linearRampToValueAtTime(1.0, currTime + CROSSFADE_DURATION);
    state.fadingIn = true;
  }

  // Convert raw bytes (PCM s16le) -> Float32 samples
  const int16 = new Int16Array(rawBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }

  const audioBuffer = audioCtx.createBuffer(DJ_CHANNELS, float32.length, DJ_SAMPLE_RATE);
  audioBuffer.copyToChannel(float32, 0);

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(state.gainNode);

  // Schedule it gaplessly for THIS track
  const duration = audioBuffer.duration;
  const currentTime = audioCtx.currentTime;
  const startAt = Math.max(state.nextStartTime, currentTime + 0.05);

  source.start(startAt);
  state.nextStartTime = startAt + duration;
}

function stopDJAudio() {
  trackStates.clear();
  currentTrackId = null;
  djIsActive = false;
}

// ── Auto-DJ socket events ──────────────────────────
socket.on('autodj-started', ({ channelId }) => {
  if (channelId !== State.channelId) return;
  console.log('[AutoDJ] Auto-DJ started on this channel');

  // Stop any offline recording that is currently playing
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.srcObject = null;
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
  }

  djIsActive = true;
  initDJAudio();
  updateStatus('📻 Auto-DJ is live — enjoy the music!', 'live');
  if (pulseRing) pulseRing.style.display = 'block';
});

socket.on('dj-audio-chunk', (payload) => {
  if (!djIsActive) return;
  try {
    const rawBuffer = payload.chunk || payload;
    const trackId = payload.trackId || 'unknown';
    const buffer = rawBuffer instanceof ArrayBuffer ? rawBuffer : rawBuffer.buffer || rawBuffer;
    scheduleChunk(buffer, trackId);
  } catch (e) {
    console.error('[AutoDJ] Chunk decode error:', e);
  }
});

socket.on('autodj-track-changed', (meta) => {
  if (meta.channelId !== State.channelId) return;
  console.log(`[AutoDJ] Now playing: "${meta.title}"(${meta.category})`);

  // Update dynamic overlay card
  showNowPlaying(meta);

  // Update original ticker if user prefers both
  const nowPlayingEl = document.getElementById('now-playing-bar');
  if (nowPlayingEl) {
    const categoryEmoji = { music: '🎵', show: '🎙️', jingle: '✨', ad: '🗣️' };
    const emoji = categoryEmoji[meta.category] || '🎵';
    nowPlayingEl.textContent = `${emoji} Now Playing: ${meta.title}`;
    nowPlayingEl.style.display = 'block';
  }
  updateStatus(`📻 Auto-DJ: ${meta.title}`, 'live');
});

let npcTimeout = null;
function showNowPlaying(meta) {
  if (!nowPlayingCard) return;

  npcTitle.textContent = meta.title;
  npcCategory.textContent = meta.category;

  // Next Track display
  if (npcNextTitle && meta.next) {
    npcNextTitle.textContent = meta.next.title;
  } else if (npcNextTitle) {
    npcNextTitle.textContent = 'Station Rotation';
  }

  // Icon mapping
  const icons = { music: 'music', show: 'mic-2', jingle: 'sparkles', ad: 'megaphone' };
  if (npcIcon && window.lucide) {
    npcIcon.setAttribute('data-lucide', icons[meta.category] || 'music');
    lucide.createIcons();
  }

  nowPlayingCard.classList.remove('hidden');

  if (npcTimeout) clearTimeout(npcTimeout);
  npcTimeout = setTimeout(() => {
    nowPlayingCard.classList.add('hidden');
  }, 10000); // Show for 10 seconds
}

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
    updateStatus('Auto-DJ on standby', 'connecting');
    if (pulseRing) pulseRing.style.display = 'none';
  }
});


socket.on('autodj-no-media', ({ channelId }) => {
  if (channelId !== State.channelId) return;
  updateStatus('No media in library. Upload tracks to start Auto-DJ.', 'offline');
});

// ── Listener Call-In Logic ─────────────────────────

function resetCallState() {
  console.log('[Call-In] Resetting state');
  if (callPC) { callPC.close(); callPC = null; }
  if (callStream) { callStream.getTracks().forEach(t => t.stop()); callStream = null; }

  callState = 'idle';
  if (requestMicBtn) {
    requestMicBtn.classList.remove('pending', 'active');
    requestMicBtn.querySelector('span').textContent = 'Request to Speak';
    requestMicBtn.disabled = false;
  }
  if (callStatusMsg) callStatusMsg.classList.add('hidden');
}

if (requestMicBtn) {
  requestMicBtn.addEventListener('click', () => {
    if (callState === 'idle') {
      const username = State.username || chatUsernameInput?.value.trim() || 'Listener';
      socket.emit('request-to-speak', { channelId: State.channelId, username });

      callState = 'requesting';
      requestMicBtn.classList.add('pending');
      requestMicBtn.querySelector('span').textContent = 'Cancel Request';
      if (callStatusMsg) {
        callStatusMsg.textContent = 'Request sent... waiting for producer';
        callStatusMsg.classList.remove('hidden');
      }
    } else {
      socket.emit('cancel-request', { channelId: State.channelId });
      resetCallState();
    }
  });
}

socket.on('call-accepted', async () => {
  console.log('[Call-In] Producer accepted! Starting mic stream...');
  callState = 'accepted';
  if (callStatusMsg) callStatusMsg.textContent = 'Call accepted! Connecting mic...';

  try {
    callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    callPC = new RTCPeerConnection(rtcConfig);
    callStream.getTracks().forEach(track => callPC.addTrack(track, callStream));

    callPC.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('call-ice', { candidate, channelId: State.channelId, toBroadcaster: true });
      }
    };

    const offer = await callPC.createOffer();
    await callPC.setLocalDescription(offer);

    socket.emit('call-offer', { sdp: offer.sdp, channelId: State.channelId });

    callState = 'connected';
    requestMicBtn.classList.remove('pending');
    requestMicBtn.classList.add('active');
    requestMicBtn.querySelector('span').textContent = 'Live on Air';
    requestMicBtn.disabled = true;
    if (callStatusMsg) callStatusMsg.textContent = '● You are LIVE on air';

  } catch (err) {
    console.error('[Call-In] Mic access error:', err);
    alert('Could not access microphone for call-in.');
    resetCallState();
  }
});

socket.on('call-answer', async (data) => {
  if (callPC) {
    await callPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
  }
});

socket.on('call-ice', async (data) => {
  if (callPC && data.candidate) {
    await callPC.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('call-rejected', () => {
  alert('The producer is not taking calls right now.');
  resetCallState();
});

socket.on('call-dropped', () => {
  console.log('[Call-In] Producer dropped call');
  resetCallState();
});


// --- STATION SCHEDULE ---

async function fetchSchedule(channelId) {
  if (!channelId) return;

  try {
    scheduleContainer.innerHTML = '<div class="schedule-loader">Loading station schedule...</div>';
    const res = await fetch(`/api/schedules/channel/${channelId}`);
    if (!res.ok) throw new Error('Failed to load schedule');

    const schedules = await res.json();
    renderSchedule(schedules);
  } catch (e) {
    console.error('[Schedule] Error:', e);
    scheduleContainer.innerHTML = '<div class="schedule-loader">Failed to load schedule. Try again later.</div>';
  }
}

function renderSchedule(schedules) {
  if (!schedules || schedules.length === 0) {
    scheduleContainer.innerHTML = '<div class="schedule-loader">No programs scheduled for this station yet.</div>';
    return;
  }

  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const grouped = {};

  // Group by day
  schedules.forEach(s => {
    if (!grouped[s.day_of_week]) grouped[s.day_of_week] = [];
    grouped[s.day_of_week].push(s);
  });

  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

  let html = '';
  // Sort by day 0-6
  Object.keys(grouped).sort().forEach(dayIdx => {
    html += `
      <div class="schedule-day">
        <h4>${days[dayIdx]}</h4>
        <div class="day-slots">
          ${grouped[dayIdx].map(slot => {
      const isToday = parseInt(dayIdx) === currentDay;
      // Basic check for "is-active"
      const isActive = isToday && currentTime >= slot.start_time.substring(0, 5) && currentTime <= slot.end_time.substring(0, 5);

      return `
              <div class="slot-item ${isActive ? 'is-active' : ''}">
                <span class="slot-time">${slot.start_time.substring(0, 5)} - ${slot.end_time.substring(0, 5)}</span>
                <span class="slot-name">Music Selection</span>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;
  });

  scheduleContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function toggleSchedule(show) {
  if (show) {
    scheduleOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    fetchSchedule(State.channelId);
  } else {
    scheduleOverlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

if (viewScheduleBtn) {
  viewScheduleBtn.addEventListener('click', () => toggleSchedule(true));
}
if (closeScheduleBtn) {
  closeScheduleBtn.addEventListener('click', () => toggleSchedule(false));
}
if (scheduleOverlay) {
  scheduleOverlay.addEventListener('click', (e) => {
    if (e.target === scheduleOverlay) toggleSchedule(false);
  });
}

// --- BROADCAST LIBRARY ---

async function fetchLibrary(channelId) {
  if (!channelId) return;

  try {
    libraryContainer.innerHTML = '<div id="archive-loader" class="schedule-loader">Opening archive vaults...</div>';
    const res = await fetch(`/api/recordings/channel/${channelId}/public`);
    if (!res.ok) throw new Error('Failed to load archive');

    allRecordings = await res.json();
    renderLibrary(allRecordings);
  } catch (e) {
    console.error('[Library] Error:', e);
    libraryContainer.innerHTML = '<div class="schedule-loader">Failed to load archive. Try again soon.</div>';
  }
}

function renderLibrary(recordings) {
  if (!recordings || recordings.length === 0) {
    libraryContainer.innerHTML = '<div class="schedule-loader">No past broadcasts found in the vaults yet.</div>';
    return;
  }

  let html = '';
  recordings.forEach(rec => {
    const dateStr = new Date(rec.created_at).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const sizeMB = (rec.filesize / (1024 * 1024)).toFixed(1);

    html += `
      <div class="recording-item" onclick="playFromArchive('${rec.id}', '${rec.title.replace(/'/g, "\\'")}')">
        <div class="ri-play-overlay">
          <div class="play-icon-circle"><i data-lucide="play"></i></div>
        </div>
        <div class="ri-date">${dateStr}</div>
        <div class="ri-title">${rec.title || 'Untitled Broadcast'}</div>
        <div class="ri-meta">
          <span><i data-lucide="hard-drive"></i> ${sizeMB} MB</span>
          <span><i data-lucide="radio"></i> Master Copy</span>
        </div>
      </div>
    `;
  });

  libraryContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function toggleLibrary(show) {
  if (show) {
    libraryOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    fetchLibrary(State.channelId);
  } else {
    libraryOverlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function playFromArchive(id, title) {
  if (!archiveAudioPlayer) return;

  // Stop live audio context if it's active
  if (audioCtx && audioCtx.state === 'running') {
    audioCtx.suspend();
  }

  // Update library player UI
  lpTitle.textContent = title;
  libraryPlayerContainer.classList.remove('hidden');

  // Set source and play
  archiveAudioPlayer.src = `/api/recordings/${id}/stream`;
  archiveAudioPlayer.load();
  archiveAudioPlayer.play().catch(e => console.error('[Archive] Playback error:', e));

  console.log(`[Archive] Streaming: ${title}`);
}

// Ensure live audio resumes if listener clicks "Tune In" again
if (tuneInBtn) {
  tuneInBtn.addEventListener('click', () => {
    if (archiveAudioPlayer) archiveAudioPlayer.pause();
    // (Other tune-in logic already exists in the file)
  });
}

if (viewLibraryBtn) {
  viewLibraryBtn.addEventListener('click', () => toggleLibrary(true));
}
if (closeLibraryBtn) {
  closeLibraryBtn.addEventListener('click', () => {
    toggleLibrary(false);
    // Maybe keep playing in background? Or stop? 
    // Broadcasters usually prefer to keep it playing unless they close the station.
  });
}
if (libraryOverlay) {
  libraryOverlay.addEventListener('click', (e) => {
    if (e.target === libraryOverlay) toggleLibrary(false);
  });
}

if (librarySearch) {
  librarySearch.addEventListener('input', (e) => {
    const search = e.target.value.toLowerCase();
    const filtered = allRecordings.filter(rec =>
      (rec.title && rec.title.toLowerCase().includes(search)) ||
      (rec.description && rec.description.toLowerCase().includes(search)) ||
      (rec.tags && rec.tags.some(t => t.toLowerCase().includes(search)))
    );
    renderLibrary(filtered);
  });
}

// Global exposure for onclick
window.playFromArchive = playFromArchive;
