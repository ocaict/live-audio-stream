const socket = io(window.SERVER_URL || '');
let peerConnection = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 50;
let reconnectDelay = 2000;

const State = {
  intent: localStorage.getItem('isListeningIntent') === 'true',
  channelId: localStorage.getItem('lastChannelId'),
  isStreaming: false,
  isReconnecting: false,
  channels: [],

  commit(key, value) {
    this[key] = value;
    if (key === 'intent') localStorage.setItem('isListeningIntent', value);
    if (key === 'channelId') localStorage.setItem('lastChannelId', value);
    console.log(`[State Change] ${key} ->`, value);
    refreshUI();
  }
};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  ]
};

const listenBtn = document.getElementById('listen-btn');
const statusText = document.getElementById('status-text');
const listenerCountEl = document.getElementById('listener-count');
const liveIndicator = document.getElementById('live-indicator');
const audioPlayer = document.getElementById('audio-player');
const pulseRing = document.querySelector('.pulse-ring');
const channelSelect = document.getElementById('channel-select');

function updateStatus(message, type = 'normal') {
  console.log(`[Status] ${message} (${type})`);
  statusText.textContent = message;
  statusText.dataset.type = type;
}

function refreshUI() {
  const selectedOption = channelSelect.options[channelSelect.selectedIndex];
  const uiLive = selectedOption?.dataset?.live === 'true';

  liveIndicator.textContent = uiLive ? '● Live' : '● Offline';
  liveIndicator.className = 'indicator ' + (uiLive ? 'live' : 'offline');

  if (State.intent) {
    listenBtn.classList.add('listening');
    listenBtn.querySelector('.text').textContent = 'Stop';
  } else {
    listenBtn.classList.remove('listening');
    listenBtn.querySelector('.text').textContent = 'Listen Live';
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
    State.channels = await res.json();
    renderChannelSelector();
  } catch (e) {
    console.error('Failed to load channels:', e);
    channelSelect.innerHTML = '<option value="">Failed to load channels</option>';
  }
}

function renderChannelSelector() {
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
        console.log('Target offline/unavailable. Waiting...');
        refreshUI();
        return;
      }
    } else if (!channel.isLive) {
      console.log('Target offline/unavailable. Waiting...');
      refreshUI();
      return;
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.ontrack = (event) => {
      console.log('Audio track established');
      if (event.streams[0]) {
        audioPlayer.srcObject = event.streams[0];
        audioPlayer.play().then(() => {
          State.commit('isStreaming', true);
          State.commit('isReconnecting', false);
          reconnectAttempts = 0;
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
      console.log('Channel not live yet, retrying in background...');
      State.commit('isReconnecting', false);
      attemptReconnect();
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

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  socket.emit('leave-listener');
  audioPlayer.srcObject = null;
  audioPlayer.pause();
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
  State.channels = channelsData;
  renderChannelSelector();
});

let lastChannelLiveEvent = null;

socket.on('channel-live', (data) => {
  // Debounce duplicate events
  const eventKey = `${data.channelId}-${data.isLive}`;
  if (lastChannelLiveEvent === eventKey) {
    return;
  }
  lastChannelLiveEvent = eventKey;
  setTimeout(() => { lastChannelLiveEvent = null; }, 500);
  
  const ch = State.channels.find(c => String(c.id) === String(data.channelId));
  
  if (ch) {
    ch.isLive = data.isLive;
  } else {
    console.log('>>> Channel not found in local state, loading...');
    loadChannels();
  }

  if (String(State.channelId) === String(data.channelId) && State.intent) {
    console.log('>>> Matching channel, intent:', State.intent);
    if (data.isLive && !State.isStreaming) {
      console.log('>>> Broadcast now live. Reconnecting...');
      setTimeout(() => {
        if (State.intent && !State.isStreaming) {
          connectToBroadcast();
        }
      }, 100);
    } else if (!data.isLive) {
      console.log('>>> Broadcast stopped.');
      State.commit('isStreaming', false);
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
    }
  }
  renderChannelSelector();
});

socket.on('listener-count', (data) => {
  if (String(State.channelId) === String(data.channelId)) {
    listenerCountEl.textContent = `Listeners: ${data.count}`;
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

loadChannels();
