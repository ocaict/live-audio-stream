const ChannelModel = require('../models/channel');
const AuthService = require('../services/authService');
const cookie = require('cookie');

const webrtcService = require('../services/webrtcService');
const recordingService = require('../services/recordingService');

function setupSocketHandlers(io) {
  // Authentication middleware
  io.use((socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const token = cookies.token;

      if (token) {
        const user = AuthService.verifyToken(token);
        if (user) {
          socket.user = user;
        }
      }
      // We allow everyone to connect (public listeners), 
      // but we will check socket.user for broadcaster-specific events.
      next();
    } catch (err) {
      console.error('Socket authentication error:', err.message);
      next();
    }
  });

  io.on('connection', (socket) => {
    let currentChannelId = null;
    let isBroadcaster = false;

    console.log('Client connected:', socket.id, socket.handshake.address);

    socket.on('disconnect', async () => {
      console.log('Client disconnected:', socket.id);
      if (currentChannelId) {
        if (isBroadcaster) {
          // Instead of immediate stop, give a grace period for reconnection
          webrtcService.requestStopBroadcast(currentChannelId, 15000, async () => {
            console.log(`[Grace Period] Broadcaster ${socket.id} for channel ${currentChannelId} did not reconnect. Stopping broadcast.`);
            // This runs ONLY if the grace period expires
            if (recordingService.isRecording(currentChannelId)) {
              try {
                const recording = await recordingService.stopRecording(currentChannelId);
                io.to(currentChannelId).emit('recording-stopped', { ...recording, channelId: currentChannelId });
                console.log(`[Grace Period] Recording finalized after timeout for ${currentChannelId}`);
              } catch (err) {
                console.error(`[Grace Period] Error stopping recording for ${currentChannelId}:`, err.message);
              }
            }
          });
        } else {
          webrtcService.removeListener(socket.id, currentChannelId);
        }
      }
    });

    socket.on('join-channel', (data) => {
      const { channelId, role } = data;

      if (role === 'broadcaster' && !socket.user) {
        socket.emit('error', 'Authentication required to broadcast');
        return;
      }

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

    socket.on('broadcaster-ready', async (data) => {
      const channelId = data?.channelId;
      if (!channelId) {
        socket.emit('error', 'Channel ID required');
        return;
      }

      webrtcService.startBroadcast(socket, channelId);
      console.log(`Broadcaster established on channel ${channelId}`);
    });

    socket.on('stop-broadcasting', async (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) {
        socket.emit('error', 'No channel specified');
        return;
      }

      if (recordingService.isRecording(channelId)) {
        socket.emit('error', 'Stop recording first before stopping broadcast');
        return;
      }

      webrtcService.stopBroadcast(channelId);
      console.log(`Broadcast stopped manually on channel ${channelId}`);
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
      if (!recordingService.isRecording(channelId)) {
        socket.emit('error', 'No recording in progress for this channel');
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
      if (currentChannelId && recordingService.isRecording(currentChannelId)) {
        recordingService.writeChunk(currentChannelId, Buffer.from(chunk));
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

    socket.on('get-channels', async () => {
      const channels = await ChannelModel.findAll();
      const channelsWithStatus = channels.map(ch => ({
        ...ch,
        isLive: webrtcService.isChannelLive(ch.id),
        listenerCount: webrtcService.getChannelListenerCount(ch.id)
      }));
      socket.emit('channels-list', channelsWithStatus);
    });
  });

  webrtcService.on('channel-live', async (data) => {
    const { channelId, isLive } = data;
    try {
      await ChannelModel.setLiveStatus(channelId, isLive);
      io.to(channelId).emit('channel-live', data);
      console.log(`[WebRTC] Channel ${channelId} status synced to DB: ${isLive}`);
    } catch (e) {
      console.error(`[WebRTC] Failed to sync channel ${channelId} status to DB:`, e.message);
      // Still emit to socket so listeners know even if DB fails
      io.to(channelId).emit('channel-live', data);
    }
  });

  webrtcService.on('listener-count-changed', (data) => {
    const { channelId, count } = data;
    io.to(channelId).emit('listener-count', { channelId, count });
  });
}

module.exports = setupSocketHandlers;
