const webrtcService = require('../services/webrtcService');
const recordingService = require('../services/recordingService');
const ChannelModel = require('../models/channel');

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    let currentChannelId = null;
    let isBroadcaster = false;

    console.log('Client connected:', socket.id, socket.handshake.address);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      if (currentChannelId) {
        if (isBroadcaster) {
          if (recordingService.isRecording()) {
            recordingService.stopRecording(currentChannelId).catch(err => {
              console.error('Error stopping recording on disconnect:', err.message);
            });
          }
          webrtcService.stopBroadcast(currentChannelId);
          ChannelModel.setLiveStatus(currentChannelId, false);
          io.to(currentChannelId).emit('channel-live', {
            channelId: currentChannelId,
            isLive: false
          });
        } else {
          webrtcService.removeListener(socket.id, currentChannelId);
        }
      }
    });

    socket.on('join-channel', (data) => {
      const { channelId, role } = data;
      currentChannelId = channelId;
      isBroadcaster = role === 'broadcaster';
      socket.join(channelId);
      console.log(`Socket ${socket.id} joined channel ${channelId} as ${role}`);
    });

    socket.on('leave-channel', () => {
      if (currentChannelId) {
        socket.leave(currentChannelId);
        if (!isBroadcaster) {
          webrtcService.removeListener(socket.id, currentChannelId);
        }
        currentChannelId = null;
        isBroadcaster = false;
      }
    });

    socket.on('join-as-listener', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) {
        socket.emit('error', 'No channel specified');
        return;
      }

      const added = webrtcService.addListener(socket, channelId);
      if (added) {
        socket.join(channelId);
        socket.emit('joined-listener');
        webrtcService.sendToBroadcaster(channelId, 'listener-joined', { socketId: socket.id });

        const listenerCount = webrtcService.getChannelListenerCount(channelId);
        io.to(channelId).emit('listener-count', { channelId, count: listenerCount });
      } else {
        socket.emit('no-broadcast');
      }
    });

    socket.on('leave-listener', () => {
      if (currentChannelId) {
        webrtcService.removeListener(socket.id, currentChannelId);
        socket.leave(currentChannelId);

        const listenerCount = webrtcService.getChannelListenerCount(currentChannelId);
        io.to(currentChannelId).emit('listener-count', { channelId: currentChannelId, count: listenerCount });
      }
    });

    socket.on('broadcaster-ready', (data) => {
      const channelId = data?.channelId;
      if (!channelId) {
        socket.emit('error', 'Channel ID required');
        return;
      }

      webrtcService.startBroadcast(socket, channelId);
      ChannelModel.setLiveStatus(channelId, true);

      console.log(`>>> Emitting channel-live:true to room ${channelId}`);
      io.to(channelId).emit('channel-live', { channelId, isLive: true });
    });

    socket.on('stop-broadcasting', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) {
        socket.emit('error', 'No channel specified');
        return;
      }

      if (recordingService.isRecording()) {
        socket.emit('error', 'Stop recording first before stopping broadcast');
        return;
      }

      webrtcService.stopBroadcast(channelId);
      ChannelModel.setLiveStatus(channelId, false);

      console.log(`>>> Emitting channel-live:false to room ${channelId}`);
      io.to(channelId).emit('channel-live', { channelId, isLive: false });
      console.log(`Broadcast stopped on channel ${channelId}`);
    });

    socket.on('offer', (data) => {
      const { sdp, socketId, channelId } = data;
      const targetChannelId = channelId || currentChannelId;

      webrtcService.sendToBroadcaster(targetChannelId, 'offer', {
        sdp,
        socketId
      });
    });

    socket.on('answer', (data) => {
      const { sdp, socketId, channelId } = data;
      const targetChannelId = channelId || currentChannelId;

      webrtcService.sendToListener(targetChannelId, socketId, 'answer', { sdp });
    });

    socket.on('ice-candidate', (data) => {
      const { candidate, target, channelId } = data;
      const targetChannelId = channelId || currentChannelId;

      if (target === 'broadcaster') {
        webrtcService.sendToBroadcaster(targetChannelId, 'ice-candidate', {
          candidate,
          socketId: socket.id
        });
      } else {
        webrtcService.sendToListener(targetChannelId, target, 'ice-candidate', { candidate });
      }
    });

    socket.on('start-recording', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) {
        socket.emit('error', 'No channel specified');
        return;
      }

      if (!webrtcService.isChannelLive(channelId)) {
        socket.emit('error', 'Cannot start recording: broadcast is not live');
        return;
      }
      try {
        const result = recordingService.startRecording(channelId);
        socket.emit('recording-started', { ...result, channelId });
      } catch (error) {
        socket.emit('error', error.message);
      }
    });

    socket.on('stop-recording', async (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!recordingService.isRecording()) {
        socket.emit('error', 'No recording in progress');
        return;
      }
      try {
        const recording = await recordingService.stopRecording(channelId);
        socket.emit('recording-stopped', { ...recording, channelId });
        io.to(channelId).emit('recording-saved', { ...recording, channelId });
      } catch (error) {
        socket.emit('error', error.message);
      }
    });

    socket.on('audio-chunk', (chunk) => {
      if (recordingService.isRecording()) {
        recordingService.writeChunk(Buffer.from(chunk));
      }
    });

    socket.on('get-live-status', (data) => {
      const channelId = data?.channelId;
      if (channelId) {
        socket.emit('channel-status', webrtcService.getStatus(channelId));
      } else {
        socket.emit('all-channel-statuses', webrtcService.getAllStatuses());
      }
    });

    socket.on('get-channels', () => {
      const channels = ChannelModel.findAll();
      const channelsWithStatus = channels.map(ch => ({
        ...ch,
        isLive: webrtcService.isChannelLive(ch.id),
        listenerCount: webrtcService.getChannelListenerCount(ch.id)
      }));
      socket.emit('channels-list', channelsWithStatus);
    });
  });

  webrtcService.on('channel-live', (data) => {
    const { channelId, isLive } = data;
    io.to(channelId).emit('channel-live', data);
  });

  webrtcService.on('listener-count-changed', (data) => {
    const { channelId, count } = data;
    io.to(channelId).emit('listener-count', { channelId, count });
  });
}

module.exports = setupSocketHandlers;
