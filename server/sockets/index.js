const ChannelModel = require('../models/channel');
const AuthService = require('../services/authService');
const cookie = require('cookie');

const webrtcService = require('../services/webrtcService');
const recordingService = require('../services/recordingService');
const MessageModel = require('../models/message');
const autoDJService = require('../services/autoDJService');
const ScheduleModel = require('../models/schedule');

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

    // Helper: Verify this socket is the active broadcaster for the channel
    const checkIsBroadcaster = (channelId) => {
      if (!channelId) return false;
      const bcSocket = webrtcService.getBroadcasterSocket(channelId);
      return bcSocket && bcSocket.id === socket.id;
    };

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
            // Auto-DJ kicks in when broadcaster does not return
            if (autoDJService.isAutoDJEnabled(currentChannelId)) {
              startAutoDJ(currentChannelId, io);
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

      // Send chat history
      MessageModel.findByChannelId(channelId).then(history => {
        socket.emit('chat-history', { channelId, messages: history });
      }).catch(e => console.error('Error sending chat history:', e.message));

      // Auto-DJ: Handover logic and Offline info
      if (role === 'listener') {
        if (autoDJService.isRunning(channelId)) {
          const meta = autoDJService.getSessionMetadata(channelId);
          socket.emit('autodj-started', { channelId });
          if (meta) {
            socket.emit('autodj-track-changed', meta);
          }
        } else if (!webrtcService.isChannelLive(channelId)) {
          // Check if Auto-DJ is allowed to start
          if (autoDJService.isAutoDJEnabled(channelId)) {
            startAutoDJ(channelId, io);
          } else {
            // Station is intentionally offline, fetch the next show
            ScheduleModel.findNextUpcomingSchedule(channelId).then(nextShow => {
              socket.emit('station-offline-info', {
                channelId,
                nextShow: nextShow ? {
                  title: nextShow.playlists?.name || 'Scheduled Broadcast',
                  startTime: nextShow.start_time,
                  dayOfWeek: nextShow.day_of_week
                } : null
              });
            });
          }
        }
      }
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

        // Send chat history for listener too
        MessageModel.findByChannelId(channelId).then(history => {
          socket.emit('chat-history', { channelId, messages: history });
        }).catch(e => console.error('Error sending chat history to listener:', e.message));
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

      if (!socket.user) {
        socket.emit('error', 'Authentication required to broadcast');
        return;
      }

      // Verify channel ownership (Fix for Unauthorized Takeover)
      try {
        const channel = await ChannelModel.findById(channelId);
        if (!channel || (channel.user_id !== socket.user.id && socket.user.role !== 'admin')) {
          socket.emit('error', 'Unauthorized: You do not own this channel');
          return;
        }
      } catch (err) {
        console.error('[Socket] Authorization error:', err.message);
        socket.emit('error', 'Server error during authorization');
        return;
      }

      // Stop Auto-DJ immediately when a real broadcaster takes over
      if (autoDJService.isRunning(channelId)) {
        console.log(`[AutoDJ] Real broadcaster took over channel ${channelId}. Stopping Auto-DJ.`);
        autoDJService.stop(channelId);
        io.to(channelId).emit('autodj-stopped', { channelId, reason: 'broadcaster_took_over' });
      }

      const channelState = webrtcService.getOrCreateChannel(channelId);
      const isReconnecting = channelState.isReconnecting;

      webrtcService.startBroadcast(socket, channelId);
      console.log(`Broadcaster established on channel ${channelId} (Reconnected: ${isReconnecting})`);

      // Notify chat: Only if it's a fresh start (not a seamless reconnection blip)
      if (!isReconnecting) {
        try {
          const systemMsg = await MessageModel.create({
            channel_id: channelId,
            username: 'System',
            content: `🎙️ Broadcaster is now LIVE! Welcome to the show.`,
            is_system: true
          });
          io.to(channelId).emit('new-message', systemMsg);
        } catch (err) {
          console.error('Failed to send join-broadcast system message:', err.message);
        }
      }
    });

    socket.on('stop-broadcasting', async (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) {
        socket.emit('error', 'No channel specified');
        return;
      }

      if (!checkIsBroadcaster(channelId)) {
        socket.emit('error', 'Unauthorized: Not the active broadcaster');
        return;
      }

      if (recordingService.isRecording(channelId)) {
        socket.emit('error', 'Stop recording first before stopping broadcast');
        return;
      }

      webrtcService.stopBroadcast(channelId);
      console.log(`Broadcast stopped manually on channel ${channelId}`);

      // Auto-DJ takes over immediately after manual stop iff enabled
      if (autoDJService.isAutoDJEnabled(channelId)) {
        startAutoDJ(channelId, io);
      }

      // Notify chat: Broadcaster left
      try {
        const systemMsg = await MessageModel.create({
          channel_id: channelId,
          username: 'System',
          content: `📻 Live broadcast has ended. Tuning into Auto-DJ...`,
          is_system: true
        });
        io.to(channelId).emit('new-message', systemMsg);
      } catch (e) {
        console.error('Failed to send end-broadcast system message');
      }
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

      if (!checkIsBroadcaster(targetChannelId)) {
        console.warn(`[Security] Unauthorized answer emit from ${socket.id}`);
        return;
      }

      webrtcService.sendToListener(targetChannelId, socketId, 'answer', { sdp });
    });

    socket.on('ice-candidate', (data) => {
      const { candidate, target, channelId } = data;
      const targetChannelId = channelId || currentChannelId;

      if (target === 'broadcaster') {
        // Listener sending to broadcaster
        webrtcService.sendToBroadcaster(targetChannelId, 'ice-candidate', {
          candidate,
          socketId: socket.id
        });
      } else {
        // Broadcaster sending to listener (must authenticate)
        if (!checkIsBroadcaster(targetChannelId)) return;
        webrtcService.sendToListener(targetChannelId, target, 'ice-candidate', { candidate });
      }
    });

    socket.on('start-recording', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) {
        socket.emit('error', 'No channel specified');
        return;
      }

      if (!checkIsBroadcaster(channelId)) {
        socket.emit('error', 'Unauthorized: Not the active broadcaster');
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

      if (!checkIsBroadcaster(channelId)) {
        socket.emit('error', 'Unauthorized: Not the active broadcaster');
        return;
      }

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
      // Must be the authorized broadcaster to supply chunks
      if (!checkIsBroadcaster(currentChannelId)) return;

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

    socket.on('send-message', async (data) => {
      const { channelId, content, username } = data;
      const targetChannelId = channelId || currentChannelId;

      if (!targetChannelId || !content || !username) {
        socket.emit('error', 'Incomplete message data');
        return;
      }

      try {
        const isAdminUser = socket.user && ['admin', 'broadcaster'].includes(socket.user.role);

        const message = await MessageModel.create({
          channel_id: targetChannelId,
          username,
          content,
          is_admin: isAdminUser // Only true if user has admin/broadcaster role
        });

        // Broadcast to everyone in the room
        io.to(targetChannelId).emit('new-message', message);
      } catch (e) {
        console.error('Failed to handle send-message:', e.message);
        socket.emit('error', 'Failed to send message');
      }
    });

    socket.on('delete-message', async (data) => {
      const isAdminUser = socket.user && ['admin', 'broadcaster'].includes(socket.user.role);
      if (!isAdminUser) { socket.emit('error', 'Auth required: Admin only'); return; }
      const { messageId, channelId } = data;
      try {
        await MessageModel.deleteById(messageId);
        io.to(channelId).emit('message-deleted', { messageId, channelId });
      } catch (e) {
        socket.emit('error', 'Failed to delete message');
      }
    });

    socket.on('clear-chat', async (data) => {
      const isAdminUser = socket.user && ['admin', 'broadcaster'].includes(socket.user.role);
      if (!isAdminUser) { socket.emit('error', 'Auth required: Admin only'); return; }
      const { channelId } = data;
      try {
        await MessageModel.deleteByChannelId(channelId);
        io.to(channelId).emit('chat-cleared', { channelId });
      } catch (e) {
        socket.emit('error', 'Failed to clear chat');
      }
    });

    // ── Admin: Manual Auto-DJ controls ──────────────────────────
    socket.on('admin-start-autodj', (data) => {
      if (!socket.user) { socket.emit('error', 'Auth required'); return; }
      const channelId = data?.channelId;
      if (!channelId) { socket.emit('error', 'channelId required'); return; }
      if (webrtcService.isChannelLive(channelId)) {
        socket.emit('error', 'Cannot start Auto-DJ: channel is currently live');
        return;
      }
      autoDJService.setAutoDJEnabled(channelId, true);
      startAutoDJ(channelId, io);
      // Emit directly to admin socket so badge updates even if not in channel room
      socket.emit('autodj-started', { channelId });
      socket.emit('autodj-control-ack', { started: true, channelId });
    });

    socket.on('admin-stop-autodj', (data) => {
      if (!socket.user) { socket.emit('error', 'Auth required'); return; }
      const channelId = data?.channelId;
      if (!channelId) { socket.emit('error', 'channelId required'); return; }
      autoDJService.setAutoDJEnabled(channelId, false);
      autoDJService.stop(channelId);
      io.to(channelId).emit('autodj-stopped', { channelId, reason: 'admin_stopped' });
      // Also emit directly to admin socket
      socket.emit('autodj-stopped', { channelId, reason: 'admin_stopped' });
      socket.emit('autodj-control-ack', { stopped: true, channelId });
    });

    socket.on('admin-skip-track', (data) => {
      if (!socket.user) { socket.emit('error', 'Auth required'); return; }
      const channelId = data?.channelId;
      if (!channelId) { socket.emit('error', 'channelId required'); return; }
      autoDJService.skipTrack(channelId);
    });

    socket.on('get-autodj-status', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) return;
      socket.emit('autodj-status', {
        channelId,
        isRunning: autoDJService.isRunning(channelId),
        currentTrack: autoDJService.getSessionMetadata(channelId)
      });
    });

    // ── Listener Call-In System ────────────────────────
    socket.on('request-to-speak', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) return;

      console.log(`[Call-In] User ${socket.id} requesting mic on ${channelId}`);
      webrtcService.sendToBroadcaster(channelId, 'call-request', {
        socketId: socket.id,
        username: data.username || 'Anonymous Listener'
      });
    });

    socket.on('cancel-request', (data) => {
      const channelId = data?.channelId || currentChannelId;
      if (!channelId) return;
      webrtcService.sendToBroadcaster(channelId, 'call-request-cancelled', { socketId: socket.id });
    });

    socket.on('accept-call', (data) => {
      if (!socket.user) return;
      const { channelId, targetSocketId } = data;
      console.log(`[Call-In] Broadcaster on ${channelId} accepted call from ${targetSocketId}`);
      webrtcService.sendToListener(channelId, targetSocketId, 'call-accepted', { channelId });
    });

    socket.on('reject-call', (data) => {
      if (!socket.user) return;
      const { channelId, targetSocketId } = data;
      webrtcService.sendToListener(channelId, targetSocketId, 'call-rejected', { channelId });
    });

    socket.on('drop-call', (data) => {
      if (!socket.user) return;
      const { channelId, targetSocketId } = data;
      webrtcService.sendToListener(channelId, targetSocketId, 'call-dropped', { channelId });
    });

    // Sub-signaling for the Call (WebRTC Peer)
    socket.on('call-offer', (data) => {
      const { sdp, targetSocketId, channelId } = data;
      webrtcService.sendToBroadcaster(channelId, 'call-offer', { sdp, socketId: socket.id });
    });

    socket.on('call-answer', (data) => {
      const { sdp, targetSocketId, channelId } = data;
      webrtcService.sendToListener(channelId, targetSocketId, 'call-answer', { sdp });
    });

    socket.on('call-ice', (data) => {
      const { candidate, targetSocketId, channelId, toBroadcaster } = data;
      if (toBroadcaster) {
        webrtcService.sendToBroadcaster(channelId, 'call-ice', { candidate, socketId: socket.id });
      } else {
        webrtcService.sendToListener(channelId, targetSocketId, 'call-ice', { candidate });
      }
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
      io.to(channelId).emit('channel-live', data);
    }
  });

  webrtcService.on('listener-count-changed', (data) => {
    const { channelId, count } = data;
    io.to(channelId).emit('listener-count', { channelId, count });
  });

  // ── Auto-DJ helpers ────────────────────────────────────────────
  function startAutoDJ(channelId, io) {
    console.log(`[AutoDJ] Activating for channel ${channelId}`);
    io.to(channelId).emit('autodj-started', { channelId });

    autoDJService.start(
      channelId,
      // emitChunk: Send raw PCM to all listeners in the room
      (chunk) => {
        io.to(channelId).emit('dj-audio-chunk', chunk);
      },
      // emitMeta: Announce track changes
      (meta) => {
        io.to(channelId).emit('autodj-track-changed', meta);
        console.log(`[AutoDJ] Track changed on ${channelId}: "${meta.title}"`);
      }
    );
  }

  autoDJService.on('no-media', ({ channelId }) => {
    io.to(channelId).emit('autodj-no-media', { channelId });
  });

  // Export a boot-up function to be called after DB is ready
  return {
    activateAllStations: async () => {
      console.log('[AutoDJ] Boot-up sequence: Activating all inactive stations...');
      try {
        const channels = await ChannelModel.findAll();
        for (const ch of channels) {
          if (!webrtcService.isChannelLive(ch.id) && !autoDJService.isRunning(ch.id) && autoDJService.isAutoDJEnabled(ch.id)) {
            startAutoDJ(ch.id, io);
          }
        }
      } catch (e) {
        console.error('[AutoDJ] Boot-up activation failed:', e.message);
      }
    }
  };
}

module.exports = setupSocketHandlers;
