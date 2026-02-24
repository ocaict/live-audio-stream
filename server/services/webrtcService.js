const EventEmitter = require('events');

class WebRTCService extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
  }

  getOrCreateChannel(channelId) {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        isLive: false,
        broadcasterSocket: null,
        listenerCount: 0,
        listenerSockets: new Map()
      });
    }
    return this.channels.get(channelId);
  }

  startBroadcast(socket, channelId) {
    const channel = this.getOrCreateChannel(channelId);
    channel.isLive = true;
    channel.broadcasterSocket = socket;
    this.emit('channel-live', { channelId, isLive: true });
  }

  stopBroadcast(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    channel.isLive = false;
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

    this.emit('channel-live', { channelId, isLive: false });
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
