const socket = io();
let peerConnection = null;
let isListening = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 1000;
let isReconnecting = false;
let wasListeningBeforeDisconnect = false;
let channels = [];
let currentChannelId = null;

const listenBtn = document.getElementById('listen-btn');
const statusText = document.getElementById('status-text');
const listenerCountEl = document.getElementById('listener-count');
const liveIndicator = document.getElementById('live-indicator');
const audioPlayer = document.getElementById('audio-player');
const pulseRing = document.querySelector('.pulse-ring');
const channelSelect = document.getElementById('channel-select');

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

function updateStatus(message, type = 'normal') {
  statusText.textContent = message;
  statusText.dataset.type = type;
}

async function loadChannels() {
  try {
    const res = await fetch('/api/channels');
    channels = await res.json();
    renderChannelSelector();
  } catch (e) {
    console.error('Failed to load channels:', e);
    channelSelect.innerHTML = '<option value="">Failed to load channels</option>';
  }
}

function renderChannelSelector() {
  if (channels.length === 0) {
    channelSelect.innerHTML = '<option value="">No channels available</option>';
    listenBtn.disabled = true;
    return;
  }

  channelSelect.innerHTML = channels.map(ch => 
    `<option value="${ch.id}" ${ch.isLive ? 'data-live="true"' : ''}>${ch.name} ${ch.isLive ? '● LIVE' : ''}</option>`
  ).join('');
  
  listenBtn.disabled = false;
  updateChannelStatus();
}

function updateChannelStatus() {
  const selectedOption = channelSelect.options[channelSelect.selectedIndex];
  const isLive = selectedOption?.dataset?.live === 'true';
  
  liveIndicator.textContent = isLive ? '● Live' : '● Offline';
  liveIndicator.className = 'indicator ' + (isLive ? 'live' : 'offline');
  
  if (isLive && !isListening) {
    updateStatus('Broadcast is live - Click to listen');
  } else if (!isListening) {
    updateStatus('Select a channel to listen');
  }
}

async function startListening() {
  if (isListening) {
    stopListening();
    return;
  }

  currentChannelId = channelSelect.value;
  if (!currentChannelId) {
    updateStatus('Please select a channel', 'error');
    return;
  }

  const channel = channels.find(c => c.id === currentChannelId);
  if (!channel || !channel.isLive) {
    updateStatus('This channel is not live', 'error');
    return;
  }

  console.log('Starting listener on channel:', currentChannelId);
  wasListeningBeforeDisconnect = true;
  
  socket.emit('join-channel', { channelId: currentChannelId, role: 'listener' });
  
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.ontrack = (event) => {
    console.log('Got track, streams:', event.streams.length);
    if (event.streams[0]) {
      audioPlayer.srcObject = event.streams[0];
      audioPlayer.play().then(() => {
        console.log('Audio playing!');
        updateStatus('Listening live!', 'success');
        pulseRing.classList.add('active');
      }).catch(e => console.error('Play failed:', e));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE state:', peerConnection.iceConnectionState);
    handleIceStateChange(peerConnection.iceConnectionState);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate, channelId: currentChannelId });
    }
  };

  try {
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    socket.emit('offer', { sdp: offer.sdp, socketId: socket.id, channelId: currentChannelId });
    socket.emit('join-as-listener', { channelId: currentChannelId });

    listenBtn.classList.add('listening');
    listenBtn.querySelector('.text').textContent = 'Stop';
    updateStatus('Connecting...', 'connecting');
    isListening = true;
    reconnectAttempts = 0;
  } catch (e) {
    console.error('Error:', e);
    updateStatus('Error: ' + e.message, 'error');
  }
}

function handleIceStateChange(state) {
  const statesToReconnect = ['failed', 'disconnected', 'closed'];
  
  if (statesToReconnect.includes(state) && isListening && !isReconnecting) {
    console.log('ICE connection state:', state, '- attempting reconnect');
    attemptReconnect();
  }
}

function attemptReconnect() {
  if (isReconnecting || reconnectAttempts >= maxReconnectAttempts) {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      updateStatus('Connection lost. Please reconnect manually.', 'error');
      stopListening();
    }
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;
  const delay = reconnectDelay * Math.pow(1.5, reconnectAttempts - 1);
  
  updateStatus(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`, 'connecting');

  setTimeout(async () => {
    if (!isListening || !currentChannelId) {
      isReconnecting = false;
      return;
    }

    try {
      if (peerConnection) {
        peerConnection.close();
      }
      
      peerConnection = new RTCPeerConnection(rtcConfig);
      
      peerConnection.ontrack = (event) => {
        if (event.streams[0]) {
          audioPlayer.srcObject = event.streams[0];
          audioPlayer.play().then(() => {
            updateStatus('Listening live!', 'success');
            pulseRing.classList.add('active');
          }).catch(e => console.error('Play failed:', e));
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        handleIceStateChange(peerConnection.iceConnectionState);
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate, channelId: currentChannelId });
        }
      };

      const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { sdp: offer.sdp, socketId: socket.id, channelId: currentChannelId });
      socket.emit('join-as-listener', { channelId: currentChannelId });
      
      isReconnecting = false;
      reconnectAttempts = 0;
      console.log('Reconnected successfully');
    } catch (e) {
      console.error('Reconnect error:', e);
      isReconnecting = false;
      attemptReconnect();
    }
  }, delay);
}

function stopListening() {
  wasListeningBeforeDisconnect = false;
  isListening = false;
  isReconnecting = false;
  reconnectAttempts = 0;
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (currentChannelId) {
    socket.emit('leave-listener');
  }
  
  audioPlayer.srcObject = null;
  audioPlayer.pause();
  listenBtn.classList.remove('listening');
  listenBtn.querySelector('.text').textContent = 'Listen Live';
  updateStatus('Select a channel to listen');
  pulseRing.classList.remove('active');
  currentChannelId = null;
}

channelSelect.addEventListener('change', () => {
  if (isListening) {
    stopListening();
  }
  updateChannelStatus();
});

listenBtn.addEventListener('click', startListening);

socket.on('connect', () => {
  console.log('Socket connected');
  loadChannels();
  socket.emit('get-live-status');
});

socket.on('disconnect', () => {
  console.log('Socket disconnected');
  if (isListening) {
    updateStatus('Connection lost. Reconnecting...', 'connecting');
  }
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
  if (isListening) {
    updateStatus('Connection error. Retrying...', 'error');
  }
});

socket.on('channels-list', (channelsData) => {
  channels = channelsData;
  renderChannelSelector();
});

socket.on('channel-live', (data) => {
  const channel = channels.find(c => c.id === data.channelId);
  if (channel) {
    channel.isLive = data.isLive;
  }
  renderChannelSelector();
  
  if (currentChannelId === data.channelId) {
    liveIndicator.textContent = data.isLive ? '● Live' : '● Offline';
    liveIndicator.className = 'indicator ' + (data.isLive ? 'live' : 'offline');
    
    if (!data.isLive && isListening) {
      stopListening();
      updateStatus('Broadcast ended', 'error');
    }
  }
});

socket.on('listener-count', (data) => {
  if (currentChannelId === data.channelId) {
    listenerCountEl.textContent = `Listeners: ${data.count}`;
  }
  
  const channel = channels.find(c => c.id === data.channelId);
  if (channel) {
    channel.listenerCount = data.count;
  }
});

socket.on('offer', async (data) => {
  console.log('Got offer');
  if (!peerConnection || !currentChannelId) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { socketId: data.socketId, sdp: answer.sdp, channelId: currentChannelId });
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
  stopListening(); 
  updateStatus('Broadcast ended', 'error'); 
});

socket.on('no-broadcast', () => { 
  updateStatus('Channel is not live', 'error'); 
  stopListening(); 
});

loadChannels();
