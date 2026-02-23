const EventEmitter = require('events');

class WebRTCService extends EventEmitter {
  constructor() {
    super();
    this.isLive = false;
    this.broadcasterSocket = null;
    this.listenerCount = 0;
    this.listenerSockets = new Map();
  }

  startBroadcast(socket) {
    this.isLive = true;
    this.broadcasterSocket = socket;
    this.emit('live-status-changed', true);
  }

  stopBroadcast() {
    this.isLive = false;
    this.broadcasterSocket = null;
    
    for (const [socketId, listenerSocket] of this.listenerSockets) {
      try {
        listenerSocket.emit('broadcast-ended');
      } catch (e) {
        console.error(`Error notifying listener ${socketId}:`, e.message);
      }
    }
    this.listenerSockets.clear();
    this.listenerCount = 0;
    
    this.emit('live-status-changed', false);
  }

  addListener(socket) {
    if (!this.isLive) return false;
    this.listenerSockets.set(socket.id, socket);
    this.listenerCount = this.listenerSockets.size;
    this.emit('listener-count-changed', this.listenerCount);
    return true;
  }

  removeListener(socketId) {
    if (this.listenerSockets.has(socketId)) {
      this.listenerSockets.delete(socketId);
      this.listenerCount = this.listenerSockets.size;
      this.emit('listener-count-changed', this.listenerCount);
    }
  }

  getStatus() {
    return {
      isLive: this.isLive,
      listenerCount: this.listenerCount
    };
  }

  getBroadcasterSocket() {
    return this.broadcasterSocket;
  }

  sendToBroadcaster(event, data) {
    if (this.broadcasterSocket) {
      try {
        this.broadcasterSocket.emit(event, data);
      } catch (e) {
        console.error('Error sending to broadcaster:', e.message);
      }
    }
  }

  sendToListener(socketId, event, data) {
    const socket = this.listenerSockets.get(socketId);
    if (socket) {
      try {
        socket.emit(event, data);
      } catch (e) {
        console.error(`Error sending to listener ${socketId}:`, e.message);
      }
    }
  }

  broadcastToListeners(event, data) {
    for (const [socketId, socket] of this.listenerSockets) {
      try {
        socket.emit(event, data);
      } catch (e) {
        console.error(`Error sending to listener ${socketId}:`, e.message);
      }
    }
  }
}

const webrtcService = new WebRTCService();

module.exports = webrtcService;
