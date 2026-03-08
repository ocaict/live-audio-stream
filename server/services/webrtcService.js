const EventEmitter = require('events');

class WebRTCService extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
    this.disconnectTimeouts = new Map();
  }

  getOrCreateChannel(channelId) {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        isLive: false,
        isReconnecting: false,
        broadcasterSocket: null,
        listenerCount: 0,
        listenerSockets: new Map()
      });
    }
    return this.channels.get(channelId);
  }

  startBroadcast(socket, channelId) {
    const channel = this.getOrCreateChannel(channelId);

    // Clear any pending disconnect timeout
    if (this.disconnectTimeouts.has(channelId)) {
      clearTimeout(this.disconnectTimeouts.get(channelId));
      this.disconnectTimeouts.delete(channelId);
      console.log(`[WebRTC] Cancelled disconnect timeout for channel ${channelId} - Broadcaster returned.`);
    }

    channel.isLive = true;
    channel.isReconnecting = false;
    channel.broadcasterSocket = socket;
    this.emit('channel-live', { channelId, isLive: true });
  }

  requestStopBroadcast(channelId, delayMs = 15000, onTimeout = null) {
    const channel = this.channels.get(channelId);
    if (!channel || !channel.isLive) return;

    if (this.disconnectTimeouts.has(channelId)) return;

    console.log(`[WebRTC] Broadcaster disconnected from ${channelId}. Waiting ${delayMs}ms for reconnection...`);
    channel.isReconnecting = true;

    const timeout = setTimeout(async () => {
      console.log(`[WebRTC] Reconnection grace period expired for ${channelId}. Cleaning up...`);
      if (onTimeout) {
        try {
          await onTimeout();
        } catch (e) {
          console.error(`[WebRTC] Error in disconnect callback for ${channelId}:`, e.message);
        }
      }
      this.stopBroadcast(channelId);
      this.disconnectTimeouts.delete(channelId);
    }, delayMs);

    this.disconnectTimeouts.set(channelId, timeout);
  }

  stopBroadcast(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    // Clear any pending timeout if stopping manually
    if (this.disconnectTimeouts.has(channelId)) {
      clearTimeout(this.disconnectTimeouts.get(channelId));
      this.disconnectTimeouts.delete(channelId);
    }

    channel.isLive = false;
    channel.isReconnecting = false;

    this.emit('channel-live', { channelId, isLive: false });

    channel.broadcasterSocket = null;

    for (const [socketId, listenerSocket] of channel.listenerSockets) {
      try {
        listenerSocket.emit('broadcast-ended');
      } catch (e) {
        console.error(`Error notifying listener ${socketId}:`, e.message);
      }
    }
    channel.listenerSockets.clear();
    channel.listenerCount = 0;
  }

  addListener(socket, channelId) {
    const channel = this.getOrCreateChannel(channelId);
    if (!channel.isLive) return false;

    channel.listenerSockets.set(socket.id, socket);
    channel.listenerCount = channel.listenerSockets.size;
    this.emit('listener-count-changed', { channelId, count: channel.listenerCount });
    return true;
  }

  removeListener(socketId, channelId) {
    const channel = this.channels.get(channelId);
    if (channel && channel.listenerSockets.has(socketId)) {
      channel.listenerSockets.delete(socketId);
      channel.listenerCount = channel.listenerSockets.size;
      this.emit('listener-count-changed', { channelId, count: channel.listenerCount });
    }
  }

  isChannelLive(channelId) {
    const channel = this.channels.get(channelId);
    return channel ? channel.isLive : false;
  }

  getChannelListenerCount(channelId) {
    const channel = this.channels.get(channelId);
    return channel ? channel.listenerCount : 0;
  }

  getStatus(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return { isLive: false, listenerCount: 0 };
    return {
      isLive: channel.isLive,
      listenerCount: channel.listenerCount
    };
  }

  getAllStatuses() {
    const statuses = {};
    for (const [channelId, channel] of this.channels) {
      statuses[channelId] = {
        isLive: channel.isLive,
        listenerCount: channel.listenerCount
      };
    }
    return statuses;
  }

  getBroadcasterSocket(channelId) {
    const channel = this.channels.get(channelId);
    return channel ? channel.broadcasterSocket : null;
  }

  sendToBroadcaster(channelId, event, data) {
    const channel = this.channels.get(channelId);
    if (channel && channel.broadcasterSocket) {
      try {
        channel.broadcasterSocket.emit(event, data);
      } catch (e) {
        console.error('Error sending to broadcaster:', e.message);
      }
    }
  }

  sendToListener(channelId, socketId, event, data) {
    const channel = this.channels.get(channelId);
    if (channel) {
      const socket = channel.listenerSockets.get(socketId);
      if (socket) {
        try {
          socket.emit(event, data);
        } catch (e) {
          console.error(`Error sending to listener ${socketId}:`, e.message);
        }
      }
    }
  }

  broadcastToListeners(channelId, event, data) {
    const channel = this.channels.get(channelId);
    if (channel) {
      for (const [socketId, socket] of channel.listenerSockets) {
        try {
          socket.emit(event, data);
        } catch (e) {
          console.error(`Error sending to listener ${socketId}:`, e.message);
        }
      }
    }
  }

  getListenerSocket(channelId, socketId) {
    const channel = this.channels.get(channelId);
    return channel ? channel.listenerSockets.get(socketId) : null;
  }
}

const webrtcService = new WebRTCService();

module.exports = webrtcService;
