const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');

const CONFIG = require('./config/constants');
const { initializeDatabase, ensureRecordingsDirectory } = require('./config/database');
const setupSocketHandlers = require('./sockets');

const authRoutes = require('./routes/auth');
const recordingsRoutes = require('./routes/recordings');
const statusRoutes = require('./routes/status');
const channelRoutes = require('./routes/channels');
const mediaRoutes = require('./routes/media');

const app = express();
const server = http.createServer(app);

// CORS configuration
const corsOptions = {
  origin: CONFIG.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Socket.IO CORS
const io = new Server(server, {
  cors: {
    origin: CONFIG.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Static files only if not in API-only mode
if (!CONFIG.API_ONLY) {
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/listen', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/listener/index.html'));
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin/index.html'));
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/listener/index.html'));
  });
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/recordings', recordingsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/media', mediaRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend from external URL in API-only mode
if (CONFIG.API_ONLY && CONFIG.FRONTEND_URL) {
  app.get('*', (req, res) => {
    res.redirect(CONFIG.FRONTEND_URL);
  });
}

setupSocketHandlers(io);

const PORT = CONFIG.PORT;

(async () => {
  try {
    CONFIG.validate();
    await initializeDatabase();
    ensureRecordingsDirectory();

    server.listen(PORT, () => {
      console.log(`Radio server running on port ${PORT}`);
      console.log(`Mode: ${CONFIG.API_ONLY ? 'API-only' : 'Full-stack'}`);
      console.log(`CORS Origin: ${CONFIG.CORS_ORIGIN}`);
      if (!CONFIG.API_ONLY) {
        console.log(`Listener: http://localhost:${PORT}/listen`);
        console.log(`Admin: http://localhost:${PORT}/admin`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Optional: Graceful shutdown if needed
});
