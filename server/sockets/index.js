const webrtcService = require('../services/webrtcService');
const recordingService = require('../services/recordingService');

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id, socket.handshake.address);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      webrtcService.removeListener(socket.id);
    });

    socket.on('join-as-listener', () => {
      const added = webrtcService.addListener(socket);
      if (added) {
        socket.join('listeners');
        socket.emit('joined-listener');
        webrtcService.sendToBroadcaster('listener-joined', { socketId: socket.id });
      } else {
        socket.emit('no-broadcast');
      }
    });

    socket.on('leave-listener', () => {
      webrtcService.removeListener(socket.id);
      socket.leave('listeners');
    });

    socket.on('broadcaster-ready', () => {
      webrtcService.startBroadcast(socket);
      io.emit('live-status', webrtcService.getStatus());
    });

    socket.on('stop-broadcasting', () => {
      if (recordingService.isRecording()) {
        socket.emit('error', 'Stop recording first before stopping broadcast');
        return;
      }
      webrtcService.stopBroadcast();
      io.emit('live-status', webrtcService.getStatus());
    });

    socket.on('offer', (data) => {
      console.log('Received offer from listener:', socket.id);
      webrtcService.sendToBroadcaster('offer', {
        sdp: data.sdp,
        socketId: socket.id
      });
    });

    socket.on('answer', (data) => {
      console.log('Received answer for listener:', data.socketId);
      webrtcService.sendToListener(data.socketId, 'answer', { sdp: data.sdp });
    });

    socket.on('ice-candidate', (data) => {
      console.log('ICE candidate, target:', data.target);
      if (data.target === 'broadcaster') {
        webrtcService.sendToBroadcaster('ice-candidate', {
          candidate: data.candidate,
          socketId: socket.id
        });
      } else {
        webrtcService.sendToListener(data.target, 'ice-candidate', { candidate: data.candidate });
      }
    });

    socket.on('start-recording', () => {
      if (!webrtcService.isLive) {
        socket.emit('error', 'Cannot start recording: broadcast is not live');
        return;
      }
      try {
        const result = recordingService.startRecording();
        socket.emit('recording-started', result);
      } catch (error) {
        socket.emit('error', error.message);
      }
    });

    socket.on('stop-recording', async () => {
      if (!recordingService.isRecording()) {
        socket.emit('error', 'No recording in progress');
        return;
      }
      try {
        const recording = await recordingService.stopRecording();
        socket.emit('recording-stopped', recording);
        io.emit('recording-saved', recording);
      } catch (error) {
        socket.emit('error', error.message);
      }
    });

    socket.on('audio-chunk', (chunk) => {
      if (recordingService.isRecording()) {
        recordingService.writeChunk(Buffer.from(chunk));
      }
    });

    socket.on('get-live-status', () => {
      socket.emit('live-status', webrtcService.getStatus());
    });
  });

  webrtcService.on('live-status-changed', (isLive) => {
    io.emit('live-status', webrtcService.getStatus());
  });

  webrtcService.on('listener-count-changed', (count) => {
    io.emit('listener-count', count);
  });
}

module.exports = setupSocketHandlers;
