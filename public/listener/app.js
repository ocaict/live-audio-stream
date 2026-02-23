const socket = io();
let peerConnection = null;
let isListening = false;

const listenBtn = document.getElementById('listen-btn');
const statusText = document.getElementById('status-text');
const listenerCountEl = document.getElementById('listener-count');
const liveIndicator = document.getElementById('live-indicator');
const audioPlayer = document.getElementById('audio-player');
const pulseRing = document.querySelector('.pulse-ring');

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

async function startListening() {
  if (isListening) {
    stopListening();
    return;
  }

  console.log('Starting listener...');
  
  peerConnection = new RTCPeerConnection(rtcConfig);
  console.log('PC created');

  peerConnection.ontrack = (event) => {
    console.log('Got track, streams:', event.streams.length);
    if (event.streams[0]) {
      audioPlayer.srcObject = event.streams[0];
      audioPlayer.play().then(() => {
        console.log('Audio playing!');
        statusText.textContent = 'Listening live!';
        pulseRing.classList.add('active');
      }).catch(e => console.error('Play failed:', e));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE state:', peerConnection.iceConnectionState);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate });
    }
  };

  try {
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);
    console.log('Offer created');

    socket.emit('offer', { sdp: offer.sdp });
    socket.emit('join-as-listener');
    console.log('Offer sent');

    listenBtn.classList.add('listening');
    listenBtn.querySelector('.text').textContent = 'Stop';
    statusText.textContent = 'Connecting...';
    isListening = true;
  } catch (e) {
    console.error('Error:', e);
    statusText.textContent = 'Error: ' + e.message;
  }
}

function stopListening() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  socket.emit('leave-listener');
  audioPlayer.srcObject = null;
  audioPlayer.pause();
  listenBtn.classList.remove('listening');
  listenBtn.querySelector('.text').textContent = 'Listen Live';
  statusText.textContent = 'Click to Listen';
  pulseRing.classList.remove('active');
  isListening = false;
}

listenBtn.addEventListener('click', startListening);

socket.on('live-status', (status) => {
  console.log('Live status:', status.isLive);
  if (status.isLive) {
    liveIndicator.textContent = '● Live';
    liveIndicator.classList.remove('offline');
    liveIndicator.classList.add('live');
    if (!isListening) statusText.textContent = 'Broadcast is live - Click to listen';
  } else {
    liveIndicator.textContent = '● Offline';
    liveIndicator.classList.remove('live');
    liveIndicator.classList.add('offline');
    if (isListening) { stopListening(); statusText.textContent = 'Broadcast ended'; }
  }
});

socket.on('listener-count', (count) => { listenerCountEl.textContent = `Listeners: ${count}`; });

socket.on('offer', async (data) => {
  console.log('Got offer');
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { socketId: data.socketId, sdp: answer.sdp });
    console.log('Answer sent');
  } catch (e) { console.error('Offer error:', e); }
});

socket.on('answer', async (data) => {
  console.log('Got answer');
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
    statusText.textContent = 'Listening live!';
    pulseRing.classList.add('active');
  } catch (e) { console.error('Answer error:', e); }
});

socket.on('ice-candidate', async (data) => {
  console.log('Got ICE candidate');
  if (!peerConnection) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) { console.error('ICE error:', e); }
});

socket.on('broadcast-ended', () => { stopListening(); statusText.textContent = 'Broadcast ended'; });
socket.on('no-broadcast', () => { statusText.textContent = 'No broadcast'; stopListening(); });

socket.emit('get-live-status');
