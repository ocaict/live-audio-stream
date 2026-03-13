const socket = io(window.SERVER_URL || '');

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch(err => console.error('[PWA] Registration failed:', err));
  });
}
let peerConnection = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 50;
let reconnectDelay = 2000;
let offlineAudio = null;
let latestRecordingUrl = null;

// Unified Playout Engine
let audioCtx = null;
let masterGain = null;
let rtcSource = null;
let rtcGain = null;
let currentActiveSource = null; // 'rtc', 'dj'
const SOURCE_FADE_MS = 1000; // 1 second crossfade between sources

// Haptic Feedback Helper
function haptics(type = 'light') {
  if (!window.navigator || !window.navigator.vibrate) return;
  const patterns = {
    light: 10,
    medium: 30,
    heavy: 60,
    success: [20, 50, 20],
    error: [50, 100, 50]
  };
  window.navigator.vibrate(patterns[type] || patterns.light);
}

// Call-In Return Feed Nodes
let callReturnSource = null;
let callReturnGain = null;

// Auto-DJ State
let djIsActive = false;
const trackStates = new Map();
let currentTrackId = null;

const State = {
  intent: localStorage.getItem('isListeningIntent') === 'true',
  channelId: localStorage.getItem('lastChannelId'),
  volume: parseFloat(localStorage.getItem('userVolume') || '0.8'),
  isStreaming: false,
  isReconnecting: false,
  isArchivePlaying: false,
  channels: [],

  commit(key, value) {
    this[key] = value;
    if (key === 'intent') localStorage.setItem('isListeningIntent', value);
    if (key === 'channelId') localStorage.setItem('lastChannelId', value);
    if (key === 'volume') {
      localStorage.setItem('userVolume', value);
      if (audioPlayer) audioPlayer.volume = value; // Fallback
      if (masterGain) masterGain.gain.setTargetAtTime(value, audioCtx.currentTime, 0.1);
    }
    console.log(`[State Change] ${key} ->`, value);
    refreshUI();
  }
};

function initMasterAudio() {
  if (!State.intent) return; // Don't touch audio until user says so
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(State.volume, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    rtcGain = audioCtx.createGain();
    rtcGain.connect(masterGain);

    // Call return feed setup
    callReturnGain = audioCtx.createGain();
    callReturnGain.connect(masterGain);
    callReturnGain.gain.value = 0; // Muted by default
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.warn('[Audio] Resume failed (Autoplay):', e));
  }
}

function transitionToSource(type) {
  if (!audioCtx || currentActiveSource === type) return;
  const currTime = audioCtx.currentTime;
  const fadeTime = SOURCE_FADE_MS / 1000;

  console.log(`[Crossfade] Transitioning ${currentActiveSource} -> ${type}`);

  // Fade out current active
  if (currentActiveSource === 'rtc' && rtcGain) {
    rtcGain.gain.setTargetAtTime(0, currTime, fadeTime / 3);
  }
  // (Auto-DJ tracks fade themselves out when trackId changes)

  // Fade in new active
  if (type === 'rtc' && rtcGain) {
    rtcGain.gain.setTargetAtTime(1, currTime, fadeTime / 3);
  } else if (type === 'dj') {
    // DJ tracks handle their own gain nodes that connect to masterGain.
    // We just ensure the others are muted.
    if (rtcGain) rtcGain.gain.setTargetAtTime(0, currTime, fadeTime / 3);
  }

  currentActiveSource = type;
}

let rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' }
  ]
};

async function loadRTCConfig() {
  try {
    const res = await fetch('/api/status/rtc-config');
    const data = await res.json();
    if (data.iceServers) {
      rtcConfig = data;
      console.log('[RTC] ICE Servers loaded from server');
    }
  } catch (e) {
    console.error('[RTC] Failed to load config, using fallback:', e);
  }
}

const listenBtn = document.getElementById('listen-btn');
const statusText = document.getElementById('status-text');
const listenerCountEl = document.getElementById('listener-count');
const liveIndicator = document.getElementById('live-indicator');
const audioPlayer = document.getElementById('audio-player');
const pulseRing = document.querySelector('.pulse-ring');
const channelSelect = document.getElementById('channel-select');
const channelList = document.getElementById('channel-list');
const volumeSlider = document.getElementById('volume-slider');
const volumeIcon = document.getElementById('volume-icon');
const ptrIndicator = document.getElementById('ptr-indicator');

// Tune-In Overlay Elements
const tuneInOverlay = document.getElementById('tune-in-overlay');
const tuneInBtn = document.getElementById('tune-in-btn');

// Call-In DOM elements
const callInControls = document.getElementById('call-in-controls');
const requestMicBtn = document.getElementById('request-mic-btn');
const callStatusMsg = document.getElementById('call-status-msg');

let callState = 'idle'; // 'idle', 'requesting', 'accepted', 'connected'
let callPC = null;
let callStream = null;

const sendBtn = document.getElementById('send-btn');

// Schedule Overlay DOM
const closeScheduleBtn = document.getElementById('close-schedule-btn');
const scheduleOverlay = document.getElementById('schedule-overlay');
const scheduleContainer = document.getElementById('schedule-container');

// Now Playing Card DOM
const nowPlayingCard = document.getElementById('now-playing-card');
const npcTitle = document.getElementById('npc-title');
const npcCategory = document.getElementById('npc-category');
const npcNextTitle = document.getElementById('npc-next-title');
const npcIcon = document.querySelector('.npc-icon i');
const closeNpcBtn = document.getElementById('close-npc-btn');

// Chat UI
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatUsernameInput = document.getElementById('chat-username');
const chatPanel = document.querySelector('.chat-panel');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatBadge = document.getElementById('chat-badge');
let unreadCount = 0;


const librarySearch = document.getElementById('library-search');

// Bottom Nav elements
const navLiveBtn = document.getElementById('nav-live-btn');
const navScheduleBtn = document.getElementById('nav-schedule-btn');
const navLibraryBtn = document.getElementById('nav-library-btn');
const navChatBtn = document.getElementById('nav-chat-btn');
const navItems = document.querySelectorAll('.nav-item');

// Overlay elements (Library)
const closeLibraryBtn = document.getElementById('close-library-btn');
const libraryOverlay = document.getElementById('library-overlay');
const libraryContainer = document.getElementById('library-container');
const archiveAudioPlayer = document.getElementById('archive-audio-player');
const libraryPlayerContainer = document.getElementById('library-player-container');
const lpTitle = document.getElementById('lp-title');
const returnToRadioBtn = document.getElementById('return-to-radio-btn');
const shareBtn = document.getElementById('share-btn');

if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    haptics('medium');
    const channelName = npcTitle ? npcTitle.textContent : 'OcaTech-Live Radio';
    const shareData = {
      title: 'OcaTech-Live Radio',
      text: `Listen to ${channelName} on OcaTech-Live! 🎧`,
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        console.log('[Share] Shared successfully');
      } else {
        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(window.location.href);
        updateStatus('Link copied to clipboard!', 'success');
        setTimeout(() => refreshUI(), 3000);
      }
    } catch (err) {
      console.error('[Share] Error:', err);
    }
  });
}

/** 🔐 AUTHENTICATION LOGIC (PHASE 1) **/
let supabase = null;
const authOverlay = document.getElementById('auth-overlay');
const authTriggerBtn = document.getElementById('auth-trigger-btn');
const closeAuthBtn = document.getElementById('close-auth-btn');
const authForm = document.getElementById('auth-form');
const googleLoginBtn = document.getElementById('google-login-btn');
const authMessage = document.getElementById('auth-message');
const userInfoDropdown = document.getElementById('user-info-dropdown');
const userProfileSection = document.getElementById('user-profile-section');
const headerUsername = document.getElementById('header-username');
const userRoleBadge = document.getElementById('user-role-badge');
const logoutBtn = document.getElementById('logout-btn');

async function initAuth() {
  try {
    // 1. Fetch public config from server
    const res = await fetch('/api/status/config');
    const config = await res.json();
    
    if (config.supabaseUrl && config.supabaseKey && window.supabase) {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
      console.log('[Auth] Supabase client initialized');
      
      // 2. Check for existing session
      const { data: { session } } = await supabase.auth.getSession();
      updateAuthUI(session);

      // 3. Listen for auth changes
      supabase.auth.onAuthStateChange((_event, session) => {
        console.log('[Auth] State changed:', _event);
        updateAuthUI(session);
      });
    }
  } catch (e) {
    console.error('[Auth] Initialization failed:', e);
  }
}

function updateAuthUI(session) {
  if (session && session.user) {
    const user = session.user;
    const metadata = user.user_metadata || {};
    
    // Update Header
    authTriggerBtn.classList.add('hidden');
    userInfoDropdown.classList.add('hidden'); // Ensure closed by default
    userProfileSection.classList.remove('hidden');
    
    const displayName = metadata.full_name || metadata.display_name || user.email.split('@')[0];
    headerUsername.textContent = displayName;
    
    // Update initials
    const initials = displayName.substring(0, 2).toUpperCase();
    document.getElementById('user-initials').textContent = initials;
    
    // Avatar handling
    const avatarUrl = metadata.avatar_url || metadata.picture;
    const avatarImg = document.getElementById('user-avatar');
    const initialsEl = document.getElementById('user-initials');
    
    if (avatarUrl) {
      avatarImg.src = avatarUrl;
      avatarImg.classList.remove('hidden');
      initialsEl.classList.add('hidden');
    } else {
      avatarImg.classList.add('hidden');
      initialsEl.classList.remove('hidden');
    }
    
    // Update chat username if it's currently anonymous
    if (chatUsernameInput && (chatUsernameInput.value.startsWith('Anonymous-') || !chatUsernameInput.value)) {
      chatUsernameInput.value = displayName;
      localStorage.setItem('chatUsername', displayName);
    }
    
    // Update State
    State.user = user;
    console.log('[Auth] User logged in:', displayName);

    // Sync with Socket
    if (socket && session.access_token) {
      socket.auth = { token: session.access_token };
      // If already connected, we might need to manual re-auth if logic requires, 
      // but for now, the next message will include the user context if we use the token in middleware
      // Or we can just reconnect for a clean slate
      if (socket.connected) {
        console.log('[Auth] Refreshing socket identity...');
        // socket.disconnect().connect(); 
      }
    }
  } else {
    // Guest State
    authTriggerBtn.classList.remove('hidden');
    userInfoDropdown.classList.add('hidden');
    State.user = null;
    if (socket) socket.auth = {};
  }
}

// UI Listeners
if (authTriggerBtn) {
  authTriggerBtn.addEventListener('click', () => {
    haptics('light');
    authOverlay.classList.remove('hidden');
  });
}

if (closeAuthBtn) {
  closeAuthBtn.addEventListener('click', () => {
    authOverlay.classList.add('hidden');
  });
}

// User Profile Click (Toggle Dropdown)
if (userProfileSection) {
  userProfileSection.addEventListener('click', (e) => {
    if (e.target.closest('.auth-trigger-btn')) return;
    userInfoDropdown.classList.toggle('hidden');
  });
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (userInfoDropdown && !userProfileSection.contains(e.target)) {
    userInfoDropdown.classList.add('hidden');
  }
});

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    haptics('medium');
    const email = document.getElementById('auth-email').value;
    const submitBtn = document.getElementById('auth-submit-btn');
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Sending...</span>';
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (error) {
      authMessage.textContent = error.message;
      authMessage.className = 'auth-message error';
    } else {
      authMessage.textContent = 'Check your email for the magic link! ✨';
      authMessage.className = 'auth-message success';
    }
    authMessage.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Send Magic Link</span> <i data-lucide="send"></i>';
    if (window.lucide) lucide.createIcons();
  });
}

if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', async () => {
    haptics('heavy');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) console.error('[Auth] Google Error:', error.message);
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    haptics('light');
    await supabase.auth.signOut();
    location.reload(); // Refresh to clear all sensitive state
  });
}

// Initialize Auth
initAuth();

let allRecordings = []; // For filtering

// Load saved username
if (chatUsernameInput) {
  let savedName = localStorage.getItem('chatUsername');
  if (!savedName) {
    savedName = `Anonymous-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem('chatUsername', savedName);
  }
  chatUsernameInput.value = savedName;
}

// Initialize volume
if (volumeSlider) {
  volumeSlider.value = State.volume;
  updateVolumeSliderBackground(State.volume);
}
if (audioPlayer) {
  audioPlayer.volume = State.volume;
}

function updateStatus(message, type = 'normal') {
  console.log(`[Status] ${message} (${type})`);
  statusText.textContent = message;
  statusText.dataset.type = type;
}

if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    State.commit('volume', vol);
    if (audioPlayer) {
      audioPlayer.volume = vol;
      audioPlayer.muted = false;
    }
    updateVolumeIcon(vol);
    updateVolumeSliderBackground(vol);
  });
}

if (volumeIcon) {
  volumeIcon.addEventListener('click', () => {
    if (audioPlayer.muted) {
      audioPlayer.muted = false;
      volumeSlider.value = State.volume;
      updateVolumeIcon(State.volume);
      updateVolumeSliderBackground(State.volume);
    } else {
      audioPlayer.muted = true;
      volumeSlider.value = 0;
      updateVolumeIcon(0);
      updateVolumeSliderBackground(0);
    }
  });
}

// Logic for Premium "Tune In" Overlay
if (tuneInBtn) {
  tuneInBtn.addEventListener('click', () => {
    haptics('medium');
    console.log('[TuneIn] User initiated playback');

    // 1. Stop any archive playback
    stopArchivePlayback();

    // 2. Hide the overlay with the fade transition
    tuneInOverlay.classList.add('hidden');

    // 3. Trigger audio start logic
    initMasterAudio();

    if (!State.intent) {
      startListening();
    } else {
      connectToBroadcast();
    }
  });
}

function updateVolumeIcon(vol) {
  if (vol === 0 || audioPlayer.muted) {
    volumeIcon.setAttribute('data-lucide', 'volume-x');
  } else if (vol < 0.5) {
    volumeIcon.setAttribute('data-lucide', 'volume-1');
  } else {
    volumeIcon.setAttribute('data-lucide', 'volume-2');
  }
  if (window.lucide) lucide.createIcons();
}

function updateVolumeSliderBackground(vol) {
  if (!volumeSlider) return;
  const percentage = vol * 100;
  volumeSlider.style.background = `linear-gradient(to right, var(--primary) ${percentage}%, rgba(255, 255, 255, 0.1) ${percentage}%)`;
}

function refreshUI() {
  const channel = State.channels.find(c => String(c.id) === String(State.channelId));
  const uiLive = channel ? channel.isLive : false;

  const statusLabel = liveIndicator.querySelector('.status-label');
  if (statusLabel) {
    statusLabel.textContent = uiLive ? 'Live' : 'Offline';
  }
  liveIndicator.className = 'indicator ' + (uiLive ? 'live' : 'offline');

  const btnIcon = listenBtn.querySelector('.btn-icon');
  const btnText = listenBtn.querySelector('.text');

  if (State.intent) {
    listenBtn.classList.add('listening');
    if (btnText) btnText.textContent = 'Stop';
    if (btnIcon) {
      btnIcon.setAttribute('data-lucide', 'square');
      lucide.createIcons();
    }
  } else {
    listenBtn.classList.remove('listening');
    if (btnText) btnText.textContent = 'Listen Live';
    if (btnIcon) {
      btnIcon.setAttribute('data-lucide', 'play');
      lucide.createIcons();
    }
  }

  if (!State.intent) {
    updateStatus(uiLive ? 'Broadcast is live - Click to listen' : 'Select a channel to listen');
    pulseRing.classList.remove('active');
  } else {
    if (State.isStreaming) {
      updateStatus('Listening live!', 'success');
      pulseRing.classList.add('active');
    } else {
      const channel = State.channels.find(c => String(c.id) === String(State.channelId));
      if (!channel || !channel.isLive) {
        updateStatus('Broadcast ended. Waiting for restart...', 'connecting');
      } else {
        updateStatus('Connecting to stream...', 'connecting');
      }
      pulseRing.classList.remove('active');
    }
  }

  // Handle Archive Mode Visuals
  const vizContainer = document.querySelector('.visualizer-container');
  if (State.isArchivePlaying) {
    if (vizContainer) vizContainer.classList.add('archive-mode');
    updateStatus('Streaming from Archive', 'success');
  } else {
    if (vizContainer) vizContainer.classList.remove('archive-mode');
  }

  // Show/Hide Call-In controls based on live status
  if (uiLive && State.intent && State.isStreaming) {
    if (callInControls) callInControls.classList.remove('hidden');
  } else {
    if (callInControls) callInControls.classList.add('hidden');
    if (callState !== 'idle') resetCallState();
  }
}

async function loadChannels() {
  try {
    // Show skeleton if no channels loaded yet
    if (State.channels.length === 0) {
      renderSkeletonChannels();
    }
    const res = await fetch('/api/channels');
    if (!res.ok) {
      throw new Error(`Failed to load channels: ${res.status}`);
    }
    const data = await res.json();
    State.channels = Array.isArray(data) ? data : [];
    renderChannelSelector();
  } catch (e) {
    console.error('Failed to load channels:', e);
    State.channels = [];
    if (channelSelect) channelSelect.innerHTML = '<option value="">Error</option>';
    if (channelList) channelList.innerHTML = '<div class="channel-loader">Failed to load channels</div>';
  }
}

function renderChannelSelector() {
  if (!Array.isArray(State.channels)) {
    State.channels = [];
  }
  const savedId = channelSelect.value || State.channelId;

  if (State.channels.length === 0) {
    if (channelSelect) channelSelect.innerHTML = '<option value="">No channels available</option>';
    if (channelList) channelList.innerHTML = '<div class="channel-loader">No active stations.</div>';
    listenBtn.disabled = true;
    return;
  }

  // Populate hidden select
  channelSelect.innerHTML = State.channels.map(ch =>
    `<option value="${ch.id}" ${String(ch.id) === String(savedId) ? 'selected' : ''} ${ch.isLive ? 'data-live="true"' : ''}>${ch.name}</option>`
  ).join('');

  // Populate visual cards
  if (channelList) {
    channelList.innerHTML = State.channels.map(ch => `
      <div class="channel-card ${String(ch.id) === String(savedId) ? 'active' : ''} ${ch.isLive ? 'live' : ''}" data-id="${ch.id}">
        <div class="cc-dot"></div>
        <div class="cc-name">${ch.name}</div>
      </div>
    `).join('');

    // Add click events to cards
    channelList.querySelectorAll('.channel-card').forEach(card => {
      card.addEventListener('click', () => {
        haptics('medium');
        const cid = card.dataset.id;
        State.commit('channelId', cid);
        channelSelect.value = cid;
        renderChannelSelector(); // Re-render to update active state
        
        // If already listening, switch immediately
        if (State.intent) {
          startListening();
        }
      });
    });
  }

  if (savedId) channelSelect.value = savedId;
  listenBtn.disabled = false;
  refreshUI();
}

async function startListening() {
  // If moving to live, stop archive
  stopArchivePlayback();
  
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  if (State.intent) {
    stopListening();
    return;
  }

  const cid = channelSelect.value;
  if (!cid) {
    updateStatus('Please select a channel', 'error');
    return;
  }

  console.log('>>> startListening - channel:', cid);
  State.commit('channelId', cid);
  State.commit('intent', true);
  connectToBroadcast();
}

let isConnecting = false;

async function connectToBroadcast() {
  if (isConnecting) {
    console.log('>>> connectToBroadcast skipped - already connecting');
    return;
  }

  if (!State.channelId || !State.intent) {
    console.log('>>> connectToBroadcast skipped - no channelId or no intent');
    return;
  }

  if (!socket.connected) {
    console.log('>>> Socket not connected, waiting...');
    return;
  }

  isConnecting = true;
  console.log('>>> connectToBroadcast - channelId:', State.channelId, 'intent:', State.intent);
  socket.emit('join-channel', { channelId: State.channelId, role: 'listener' });
  console.log('>>> join-channel emitted');

  try {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (!channel || !channel.isLive) {
      console.log('Target offline, waiting for Live or Auto-DJ...');
      updateStatus('Station is currently on standby', 'connecting');
      return;
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.ontrack = (event) => {
      console.log('Audio track established');
      if (event.streams[0]) {
        // Buffering hint: 500ms jitter buffer for smoother radio experience
        try {
          const receivers = peerConnection.getReceivers();
          const audioReceiver = receivers.find(r => r.track?.kind === 'audio');
          if (audioReceiver && 'playoutDelayHint' in audioReceiver) {
            audioReceiver.playoutDelayHint = 0.5;
            console.log('[RTC] Buffering enabled: 500ms delay hint set.');
          }
        } catch (e) { console.warn('[RTC] PlayoutDelayHint not supported:', e); }

        audioPlayer.srcObject = event.streams[0];
        audioPlayer.volume = State.volume;

        initMasterAudio();
        // Pipe WebRTC into AudioContext for Global Crossfade
        if (rtcSource) rtcSource.disconnect();
        rtcSource = audioCtx.createMediaStreamSource(event.streams[0]);
        rtcSource.connect(rtcGain);
        transitionToSource('rtc');

        audioPlayer.play().then(() => {
          State.commit('isStreaming', true);
          State.commit('isReconnecting', false);
          reconnectAttempts = 0;
          initVisualizer(event.streams[0]);
        }).catch(e => {
          console.warn('Autoplay blocked');
          State.commit('isStreaming', true);
          updateStatus('⚠️ Click anywhere to unmute stream!', 'error');
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      handleIceStateChange(peerConnection.iceConnectionState);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate, channelId: State.channelId });
      }
    };

    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    socket.emit('offer', { sdp: offer.sdp, socketId: socket.id, channelId: State.channelId });
    socket.emit('join-as-listener', { channelId: State.channelId });

  } catch (e) {
    console.error('Connection error:', e);
    if (State.intent) {
      attemptReconnect();
    }
  } finally {
    isConnecting = false;
  }
}

function handleIceStateChange(state) {
  const statesToReconnect = ['failed', 'disconnected', 'closed'];

  if (statesToReconnect.includes(state) && State.intent && !State.isReconnecting) {
    console.log('ICE connection state:', state, '- attempting reconnect');
    State.commit('isStreaming', false);
    attemptReconnect();
  }
}

function attemptReconnect() {
  console.log('>>> attemptReconnect called, intent:', State.intent, 'channelId:', State.channelId, 'attempts:', reconnectAttempts);
  if (State.isReconnecting || reconnectAttempts >= maxReconnectAttempts) {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      updateStatus('Connection lost. Please reconnect manually.', 'error');
      stopListening();
    }
    return;
  }

  State.commit('isReconnecting', true);
  reconnectAttempts++;
  const delay = reconnectDelay * Math.pow(1.5, reconnectAttempts - 1);

  updateStatus(`Reconnecting... (${reconnectAttempts} / ${maxReconnectAttempts})`, 'connecting');

  setTimeout(async () => {
    if (!State.intent || !State.channelId) {
      console.log('Reconnection aborted: intent cleared');
      State.commit('isReconnecting', false);
      return;
    }

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (!channel || !channel.isLive) {
      console.log('Channel not live, staying on standby...');
      State.commit('isReconnecting', false);
      refreshUI();
      return;
    }

    await connectToBroadcast();
  }, delay);
}

function stopListening() {
  console.log('Stopping...');
  State.commit('intent', false);
  State.commit('isStreaming', false);
  State.commit('isReconnecting', false);
  stopVisualizer();

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  socket.emit('leave-listener');
  audioPlayer.srcObject = null;
  audioPlayer.src = '';
  audioPlayer.pause();
  audioPlayer.loop = false;
  latestRecordingUrl = null;
}

channelSelect.addEventListener('change', (e) => {
  if (e.isTrusted && State.intent) {
    stopListening();
  }
  refreshUI();
});

listenBtn.addEventListener('click', startListening);

document.addEventListener('click', () => {
  if (State.intent && audioPlayer.paused && audioPlayer.srcObject) {
    console.log('User interaction: Attempting audio resume...');
    audioPlayer.play()
      .then(() => {
        State.commit('isStreaming', true);
      })
      .catch(e => console.error('Unlock failed:', e));
  }
}, { once: false });

socket.on('connect', async () => {
  await loadChannels();

  if (State.intent && State.channelId) {
    socket.emit('join-channel', { channelId: State.channelId, role: 'listener' });

    const channel = State.channels.find(c => String(c.id) === String(State.channelId));
    if (channel && channel.isLive) {
      connectToBroadcast();
    } else {
      refreshUI();
    }
  } else {
    refreshUI();
  }
});

socket.on('disconnect', () => {
  console.log('>>> Socket disconnected');
  if (State.intent) {
    State.commit('isStreaming', false);
    updateStatus('Connection lost. Syncing...', 'connecting');
  }
});

socket.on('connect_error', (error) => {
  console.error('>>> Socket connection error:', error);
  if (State.intent) {
    updateStatus('Server unavailable. Retrying connection...', 'error');
  }
});

socket.on('channels-list', (channelsData) => {
  State.channels = Array.isArray(channelsData) ? channelsData : [];
  renderChannelSelector();
});

let lastChannelLiveEvent = null;

socket.on('channel-live', (data) => {
  const eventKey = `${data.channelId} -${data.isLive} `;
  if (lastChannelLiveEvent === eventKey) {
    return;
  }
  lastChannelLiveEvent = eventKey;
  setTimeout(() => { lastChannelLiveEvent = null; }, 500);

  if (!Array.isArray(State.channels)) {
    State.channels = [];
  }
  const ch = State.channels.find(c => String(c.id) === String(data.channelId));
  if (ch) {
    ch.isLive = data.isLive;
  } else {
    console.log('>>> Channel not found in local state, loading...');
    loadChannels();
  }

  if (String(State.channelId) === String(data.channelId) && State.intent) {
    console.log('>>> Matching channel, intent:', State.intent, 'isLive:', data.isLive, 'isStreaming:', State.isStreaming);
    if (data.isLive) {
      console.log('>>> Broadcast now live. Stopping Auto-DJ and connecting to live stream...');
      // Stop Auto-DJ immediately so there's no double-audio
      if (djIsActive) {
        stopDJAudio();
        const nowPlayingEl = document.getElementById('now-playing-bar');
        if (nowPlayingEl) nowPlayingEl.style.display = 'none';
      }
      audioPlayer.pause();
      audioPlayer.src = '';
      audioPlayer.loop = false;
      latestRecordingUrl = null;
      setTimeout(() => {
        if (State.intent) {
          connectToBroadcast();
        }
      }, 100);
    } else if (!data.isLive) {
      console.log('>>> Broadcast stopped.');
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      State.commit('isStreaming', false);
      updateStatus('Broadcast ended. Station returning to feed...', 'connecting');
    }
  }
  renderChannelSelector();
});

socket.on('listener-count', (data) => {
  if (String(State.channelId) === String(data.channelId)) {
    // Keep icons, update text
    const icon = listenerCountEl.querySelector('i, svg');
    listenerCountEl.innerHTML = '';
    if (icon) listenerCountEl.appendChild(icon);
    listenerCountEl.appendChild(document.createTextNode(` ${data.count} `));
  }

  const channel = State.channels.find(c => c.id === data.channelId);
  if (channel) {
    channel.listenerCount = data.count;
  }
});

socket.on('offer', async (data) => {
  console.log('Got offer');
  if (!peerConnection || !State.channelId) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { socketId: data.socketId, sdp: answer.sdp, channelId: State.channelId });
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
  if (State.intent) {
    console.log('Server signal: broadcast ended');
    updateStatus('Broadcast ended. Waiting for restart...', 'connecting');
    pulseRing.classList.remove('active');
    State.commit('isStreaming', false);
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  }
});

socket.on('no-broadcast', () => {
  if (State.intent) {
    console.log('Server signal: no broadcast');
    updateStatus('Broadcaster not ready. Waiting...', 'connecting');
    State.commit('isStreaming', false);
    if (!State.isReconnecting) {
      attemptReconnect();
    }
  }
});

socket.on('station-offline-info', (data) => {
  if (String(data.channelId) !== String(State.channelId)) return;

  if (data.nextShow) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const isToday = data.nextShow.dayOfWeek === now.getUTCDay();
    const dayName = isToday ? 'Today' : days[data.nextShow.dayOfWeek];
    const timeStr = data.nextShow.startTime.substring(0, 5);

    updateStatus(`Next show ${dayName} at ${timeStr}: ${data.nextShow.title}`, 'connecting');
  } else {
    updateStatus('Station is currently on standby', 'connecting');
  }
});

/* Interactive Chat Logic */
socket.on('chat-history', (data) => {
  if (String(data.channelId) !== String(State.channelId)) return;
  chatMessages.innerHTML = '';
  if (data.messages.length === 0) {
    chatMessages.innerHTML = '<div class="chat-placeholder">Welcome! Join the conversation below.</div>';
  } else {
    data.messages.forEach(msg => appendMessage(msg));
  }
});

socket.on('new-message', (msg) => {
  if (String(msg.channel_id) !== String(State.channelId)) return;

  // Remove placeholder if it exists
  const placeholder = chatMessages.querySelector('.chat-placeholder');
  if (placeholder) placeholder.remove();

  appendMessage(msg);

  // Badge logic
  if (!chatPanel.classList.contains('open')) {
    unreadCount++;
    if (chatBadge) {
      chatBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      chatBadge.classList.remove('hidden');
    }
  }
});

socket.on('message-deleted', (data) => {
  if (data.channelId !== State.channelId) return;
  const msgEl = document.querySelector(`.message-item[data-id="${data.messageId}"]`);
  if (msgEl) {
    msgEl.classList.add('deleted');
    setTimeout(() => msgEl.remove(), 300);
  }
});

socket.on('chat-cleared', (data) => {
  if (data.channelId !== State.channelId) return;
  chatMessages.innerHTML = '<div class="chat-placeholder">No messages yet. Start the conversation!</div>';
});

function appendMessage(msg) {
  const currentUsername = chatUsernameInput.value.trim() || 'Anonymous';
  const isOwn = msg.username === currentUsername;
  const isAdmin = msg.is_admin === true;
  const isSystem = msg.is_system === true;
  const isVerified = msg.is_verified === true;

  const div = document.createElement('div');
  div.className = `message-item ${isOwn ? 'own' : ''} ${isAdmin ? 'is-admin' : ''} ${isSystem ? 'is-system' : ''} ${isVerified ? 'is-verified' : ''}`;
  div.dataset.id = msg.id;

  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.innerHTML = `
    <div class="message-meta">
      ${isAdmin ? '<span class="admin-badge">Broadcaster</span>' : (isVerified ? '<span class="verified-badge"><i data-lucide="shield-check"></i> Member</span>' : '')}
      <span class="meta-text"></span>
    </div>
    <div class="chat-bubble"></div>
  `;

  if (window.lucide) lucide.createIcons();

  // Safely inject untrusted user data using textContent to prevent XSS
  div.querySelector('.meta-text').textContent = `${msg.username} • ${time}`;
  div.querySelector('.chat-bubble').textContent = msg.content;

  const isNearBottom = chatMessages.scrollHeight - chatMessages.clientHeight <= chatMessages.scrollTop + 100;
  chatMessages.appendChild(div);
  
  if (isNearBottom || isOwn) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

if (chatToggleBtn) {
  chatToggleBtn.addEventListener('click', () => {
    haptics('medium');
    chatPanel.classList.add('open');
    if (chatBadge) chatBadge.classList.add('hidden');
    updateNavActive(navChatBtn);
  });
}

// Bottom Nav Logic
function updateNavActive(activeBtn) {
  if (!navItems) return;
  navItems.forEach(item => item.classList.remove('active'));
  if (activeBtn) activeBtn.classList.add('active');
}

if (navLiveBtn) {
  navLiveBtn.addEventListener('click', () => {
    updateNavActive(navLiveBtn);
    // Close any open overlays
    toggleSchedule(false);
    toggleLibrary(false);
    if (chatPanel) chatPanel.classList.remove('open');
  });
}

if (navScheduleBtn) {
  navScheduleBtn.addEventListener('click', () => {
    updateNavActive(navScheduleBtn);
    toggleSchedule(true);
  });
}

if (navLibraryBtn) {
  navLibraryBtn.addEventListener('click', () => {
    updateNavActive(navLibraryBtn);
    toggleLibrary(true);
  });
}

if (navChatBtn) {
  navChatBtn.addEventListener('click', () => {
    updateNavActive(navChatBtn);
    chatPanel.classList.add('open');
    unreadCount = 0;
    if (chatBadge) {
      chatBadge.textContent = '';
      chatBadge.classList.add('hidden');
    }
  });
}

if (closeChatBtn) {
  closeChatBtn.addEventListener('click', () => {
    haptics('light');
    chatPanel.classList.remove('open');
    updateNavActive(navLiveBtn); // Default back to Live when chat closes
  });
}

let chatCooldown = false;
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (chatCooldown) return;
  haptics('medium');

  const content = chatInput.value.trim();
  const username = chatUsernameInput.value.trim() || 'Anonymous';

  if (!content || !State.channelId) return;

  // Persist username
  localStorage.setItem('chatUsername', username);

  const payload = {
    channelId: State.channelId,
    content,
    username,
    userId: State.user ? State.user.id : null,
    isVerified: !!State.user
  };

  socket.emit('send-message', payload);

  chatInput.value = '';

  // Trigger cooldown
  chatCooldown = true;
  const submitBtn = chatForm.querySelector('.send-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('cooldown');
  }

  setTimeout(() => {
    chatCooldown = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('cooldown');
    }
  }, 2000);
});

/* Visualizer Logic */
let visualizerContext = null;
let animationId = null;
let currentVisualMode = localStorage.getItem('visualizerMode') || 'bars'; // bars, wave, pulse

const visualModeBtn = document.getElementById('visual-mode-btn');
if (visualModeBtn) {
  visualModeBtn.addEventListener('click', () => {
    haptics('light');
    const modes = ['bars', 'wave', 'pulse'];
    const nextIndex = (modes.indexOf(currentVisualMode) + 1) % modes.length;
    currentVisualMode = modes[nextIndex];
    localStorage.setItem('visualizerMode', currentVisualMode);
    console.log('[Visualizer] Mode switched to:', currentVisualMode);
  });
}

function initVisualizer(stream) {
  if (!stream) return;

  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');

  canvas.width = 220;
  canvas.height = 220;

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128; // Higher res for wave

  source.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    animationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 60;

    if (currentVisualMode === 'bars') {
      // MODE: REACTIVE NEON BARS
      ctx.lineWidth = 3;
      for (let i = 0; i < bufferLength; i += 2) {
        const val = dataArray[i] / 255;
        const barHeight = val * 35;
        const angle = (i * 2 * Math.PI) / bufferLength;
        
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);

        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, '#ff2d55');
        grad.addColorStop(1, '#00f2ea');
        
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else if (currentVisualMode === 'wave') {
      // MODE: LIQUID WAVE RING
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#00f2ea';
      ctx.beginPath();
      for (let i = 0; i <= bufferLength; i++) {
        const val = (dataArray[i % bufferLength] / 255) * 20;
        const angle = (i * 2 * Math.PI) / bufferLength;
        const x = centerX + Math.cos(angle) * (radius + val);
        const y = centerY + Math.sin(angle) * (radius + val);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      
      // Subtle glow fill
      ctx.fillStyle = 'rgba(0, 242, 234, 0.1)';
      ctx.fill();
    } else if (currentVisualMode === 'pulse') {
      // MODE: ENERGETIC PULSE RINGS
      const val = dataArray[4] / 255; // Lower frequency for kick pulse
      const pulseSize = val * 40;
      
      ctx.strokeStyle = `rgba(255, 45, 85, ${0.8 - val * 0.5})`;
      ctx.lineWidth = 2 + val * 5;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + pulseSize, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + pulseSize * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 242, 234, ${0.5})`;
      ctx.stroke();
    }
  }

  draw();
}

function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

loadChannels();
loadRTCConfig();

// =============================================
// AUTO-DJ LISTENER: PCM Audio Decoder with Crossfading
// =============================================
const DJ_SAMPLE_RATE = 44100;
const DJ_CHANNELS = 1;
const CROSSFADE_DURATION = 3.0; // 3 seconds overlap

function initDJAudio() {
  if (!State.intent) return;
  initMasterAudio();
  djIsActive = true;
  transitionToSource('dj');
}

function scheduleChunk(rawBuffer, trackId) {
  if (!audioCtx || !State.intent) return;

  // Initialize track state if this is a new track
  if (!trackStates.has(trackId)) {
    const gainNode = audioCtx.createGain();
    gainNode.connect(masterGain);

    // Start silent, we will fade in
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    trackStates.set(trackId, {
      nextStartTime: audioCtx.currentTime + 0.1, // Slight buffer
      gainNode: gainNode,
      fadingIn: false
    });

    // If there is an existing track playing, tell it to fade out
    if (currentTrackId && currentTrackId !== trackId && trackStates.has(currentTrackId)) {
      const oldState = trackStates.get(currentTrackId);
      const currTime = audioCtx.currentTime;

      // Stop previous track's fade-in if it was still happening
      oldState.gainNode.gain.cancelScheduledValues(currTime);
      oldState.gainNode.gain.setValueAtTime(oldState.gainNode.gain.value, currTime);

      // Fade out over X seconds
      oldState.gainNode.gain.linearRampToValueAtTime(0, currTime + CROSSFADE_DURATION);

      // Clean up the old track state memory after fade completes
      const toDelete = currentTrackId;
      setTimeout(() => {
        trackStates.delete(toDelete);
      }, (CROSSFADE_DURATION + 1) * 1000);
    }

    currentTrackId = trackId;
  }

  const state = trackStates.get(trackId);

  // Crossfade Trigger: Fade in the new track
  if (!state.fadingIn) {
    const currTime = audioCtx.currentTime;
    state.gainNode.gain.linearRampToValueAtTime(1.0, currTime + CROSSFADE_DURATION);
    state.fadingIn = true;
  }

  // Convert raw bytes (PCM s16le) -> Float32 samples
  const int16 = new Int16Array(rawBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }

  const audioBuffer = audioCtx.createBuffer(DJ_CHANNELS, float32.length, DJ_SAMPLE_RATE);
  audioBuffer.copyToChannel(float32, 0);

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(state.gainNode);

  // Schedule it gaplessly for THIS track
  const duration = audioBuffer.duration;
  const currentTime = audioCtx.currentTime;
  const startAt = Math.max(state.nextStartTime, currentTime + 0.05);

  source.start(startAt);
  state.nextStartTime = startAt + duration;
}

function stopDJAudio() {
  trackStates.clear();
  currentTrackId = null;
  djIsActive = false;
}

// ── Auto-DJ socket events ──────────────────────────
socket.on('autodj-started', ({ channelId }) => {
  if (channelId !== State.channelId) return;
  console.log('[AutoDJ] Auto-DJ started on this channel');

  // Stop any offline recording that is currently playing
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.srcObject = null;
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
  }

  djIsActive = true;
  initDJAudio();
  updateStatus('📻 Auto-DJ is live — enjoy the music!', 'live');
  if (pulseRing) pulseRing.style.display = 'block';
});

socket.on('dj-audio-chunk', (payload) => {
  if (!djIsActive) return;
  try {
    const rawBuffer = payload.chunk || payload;
    const trackId = payload.trackId || 'unknown';
    const buffer = rawBuffer instanceof ArrayBuffer ? rawBuffer : rawBuffer.buffer || rawBuffer;
    scheduleChunk(buffer, trackId);
  } catch (e) {
    console.error('[AutoDJ] Chunk decode error:', e);
  }
});

socket.on('autodj-track-changed', (meta) => {
  if (meta.channelId !== State.channelId) return;
  console.log(`[AutoDJ] Now playing: "${meta.title}"(${meta.category})`);

  // Update dynamic overlay card
  showNowPlaying(meta);

  // Update original ticker if user prefers both
  const nowPlayingEl = document.getElementById('now-playing-bar');
  if (nowPlayingEl) {
    const categoryEmoji = { music: '🎵', show: '🎙️', jingle: '✨', ad: '🗣️' };
    const emoji = categoryEmoji[meta.category] || '🎵';
    nowPlayingEl.textContent = `${emoji} Now Playing: ${meta.title}`;
    nowPlayingEl.style.display = 'block';
  }
  updateStatus(`📻 Auto-DJ: ${meta.title}`, 'live');
  updateMediaSession(meta);
});

function updateMediaSession(meta) {
  if (!('mediaSession' in navigator)) return;

  const currentChannel = State.channels.find(c => String(c.id) === String(State.channelId));
  const stationName = currentChannel ? currentChannel.name : 'OcaTech-Live';

  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title || 'Live Stream',
    artist: stationName,
    album: meta.category ? meta.category.toUpperCase() : 'Radio',
    artwork: [
      { src: '/listener/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/listener/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });

  // Action handlers for lock screen controls
  navigator.mediaSession.setActionHandler('play', () => {
    if (!State.intent) startListening();
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    if (State.intent) stopListening();
  });
}

let npcTimeout = null;

if (closeNpcBtn) {
  closeNpcBtn.addEventListener('click', () => {
    if (nowPlayingCard) nowPlayingCard.classList.add('hidden');
    if (npcTimeout) clearTimeout(npcTimeout);
  });
}

function showNowPlaying(meta) {
  if (!nowPlayingCard) return;

  npcTitle.textContent = meta.title;
  npcCategory.textContent = meta.category;

  // Next Track display
  if (npcNextTitle && meta.next) {
    npcNextTitle.textContent = meta.next.title;
  } else if (npcNextTitle) {
    npcNextTitle.textContent = 'Station Rotation';
  }

  // Icon mapping
  const icons = { music: 'music', show: 'mic-2', jingle: 'sparkles', ad: 'megaphone' };
  if (npcIcon && window.lucide) {
    npcIcon.setAttribute('data-lucide', icons[meta.category] || 'music');
    lucide.createIcons();
  }

  nowPlayingCard.classList.remove('hidden');

  if (npcTimeout) clearTimeout(npcTimeout);
  npcTimeout = setTimeout(() => {
    nowPlayingCard.classList.add('hidden');
  }, 10000); // Show for 10 seconds
}

socket.on('autodj-stopped', ({ channelId, reason }) => {
  if (channelId !== State.channelId) return;
  console.log('[AutoDJ] Stopped, reason:', reason);
  stopDJAudio();
  djIsActive = false;

  const nowPlayingEl = document.getElementById('now-playing-bar');
  if (nowPlayingEl) nowPlayingEl.style.display = 'none';

  if (reason === 'broadcaster_took_over') {
    updateStatus('🎙️ Live broadcast resumed', 'live');
  } else {
    updateStatus('Auto-DJ on standby', 'connecting');
    if (pulseRing) pulseRing.style.display = 'none';
  }
});


socket.on('autodj-no-media', ({ channelId }) => {
  if (channelId !== State.channelId) return;
  updateStatus('No media in library. Upload tracks to start Auto-DJ.', 'offline');
});

// ── Listener Call-In Logic ─────────────────────────

function resetCallState() {
  console.log('[Call-In] Resetting state');
  if (callPC) { callPC.close(); callPC = null; }
  if (callStream) { callStream.getTracks().forEach(t => t.stop()); callStream = null; }

  // Restoring main player volume
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(State.volume, audioCtx.currentTime, 0.5);
  }
  
  // Cleanup return feed nodes
  if (callReturnSource) { callReturnSource.disconnect(); callReturnSource = null; }
  if (callReturnGain) {
    callReturnGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
  }

  callState = 'idle';
  if (requestMicBtn) {
    requestMicBtn.classList.remove('pending', 'active', 'hangup');
    requestMicBtn.querySelector('span').textContent = 'Request to Speak';
    requestMicBtn.disabled = false;
  }
  if (callStatusMsg) callStatusMsg.classList.add('hidden');
}

if (requestMicBtn) {
  requestMicBtn.addEventListener('click', () => {
    if (callState === 'idle') {
      const username = State.username || chatUsernameInput?.value.trim() || 'Listener';
      socket.emit('request-to-speak', { channelId: State.channelId, username });

      callState = 'requesting';
      requestMicBtn.classList.add('pending');
      requestMicBtn.querySelector('span').textContent = 'Cancel Request';
      if (callStatusMsg) {
        callStatusMsg.textContent = 'Request sent... waiting for producer';
        callStatusMsg.classList.remove('hidden');
      }
    } else {
      socket.emit('cancel-request', { channelId: State.channelId });
      resetCallState();
    }
  });
}

socket.on('call-accepted', async () => {
  console.log('[Call-In] Producer accepted! Starting mic stream...');
  callState = 'accepted';
  if (callStatusMsg) callStatusMsg.textContent = 'Call accepted! Connecting mic...';

  // Proactively init audio context to ensure we can mute/play return feed
  initMasterAudio();

  // Muting main station volume to prevent echo (Delayed Feedback)
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.5);
  }

  try {
    callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    callPC = new RTCPeerConnection(rtcConfig);
    callStream.getTracks().forEach(track => callPC.addTrack(track, callStream));

    // Handle return feed from Broadcaster
    callPC.ontrack = (event) => {
      console.log('[Call-In] Received return audio track from Broadcaster!');
      const stream = event.streams[0];
      if (audioCtx && callReturnGain) {
        callReturnSource = audioCtx.createMediaStreamSource(stream);
        callReturnSource.connect(callReturnGain);
        callReturnGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.1);
      }
    };

    callPC.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('call-ice', { candidate, channelId: State.channelId, toBroadcaster: true });
      }
    };

    const offer = await callPC.createOffer();
    await callPC.setLocalDescription(offer);

    socket.emit('call-offer', { sdp: offer.sdp, channelId: State.channelId });

    callState = 'connected';
    requestMicBtn.classList.remove('pending', 'active');
    requestMicBtn.classList.add('hangup'); 
    requestMicBtn.querySelector('span').textContent = 'End Call';
    requestMicBtn.disabled = false; // Enabled so user can hang up
    if (callStatusMsg) callStatusMsg.textContent = '● You are LIVE on air';

  } catch (err) {
    console.error('[Call-In] Mic access error:', err);
    alert('Could not access microphone for call-in.');
    resetCallState();
  }
});

socket.on('call-answer', async (data) => {
  if (callPC) {
    await callPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
  }
});

socket.on('call-ice', async (data) => {
  if (callPC && data.candidate) {
    await callPC.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('call-rejected', () => {
  alert('The producer is not taking calls right now.');
  resetCallState();
});

socket.on('call-dropped', () => {
  console.log('[Call-In] Producer dropped call');
  resetCallState();
});


// --- STATION SCHEDULE ---

async function fetchSchedule(channelId) {
  if (!channelId) return;

  try {
    renderSkeletonSchedule();
    const res = await fetch(`/api/schedules/channel/${channelId}`);
    if (!res.ok) throw new Error('Failed to load schedule');

    const schedules = await res.json();
    renderSchedule(schedules);
  } catch (e) {
    console.error('[Schedule] Error:', e);
    scheduleContainer.innerHTML = '<div class="schedule-loader">Failed to load schedule. Try again later.</div>';
  }
}

function renderSchedule(schedules) {
  if (!schedules || schedules.length === 0) {
    scheduleContainer.innerHTML = '<div class="schedule-loader">No programs scheduled for this station yet.</div>';
    return;
  }

  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  // Sort by day then by time
  const sortedSchedules = schedules.sort((a,b) => {
    if(a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return a.start_time.localeCompare(b.start_time);
  });

  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

  let html = '';
  let lastDay = -1;

  sortedSchedules.forEach(slot => {
    if (slot.day_of_week !== lastDay) {
      html += `<div class="schedule-day-label">${days[slot.day_of_week]}</div>`;
      lastDay = slot.day_of_week;
    }

    const playlistName = slot.playlists ? slot.playlists.name : 'Music Selection';
    const isToday = parseInt(slot.day_of_week) === currentDay;
    const isActive = isToday && currentTime >= slot.start_time.substring(0, 5) && currentTime <= slot.end_time.substring(0, 5);

    html += `
      <div class="slot-item ${isActive ? 'is-active' : ''}">
        <div class="slot-time">
          <span class="st-start">${slot.start_time.substring(0, 5)}</span>
          <span class="st-end">${slot.end_time.substring(0, 5)}</span>
        </div>
        <div class="slot-info">
          <div class="slot-name">${playlistName}</div>
          <div class="slot-desc">${isActive ? 'Currently live on air' : 'Scheduled broadcast'}</div>
        </div>
        ${isActive ? '<div class="slot-live-badge">LIVE</div>' : '<i data-lucide="clock" class="slot-clock"></i>'}
      </div>
    `;
  });

  scheduleContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function toggleSchedule(show) {
  if (show) {
    scheduleOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    fetchSchedule(State.channelId);
    updateNavActive(navScheduleBtn);
  } else {
    scheduleOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    updateNavActive(navLiveBtn);
  }
}

if (closeScheduleBtn) {
  closeScheduleBtn.addEventListener('click', () => toggleSchedule(false));
}
if (scheduleOverlay) {
  scheduleOverlay.addEventListener('click', (e) => {
    if (e.target === scheduleOverlay) toggleSchedule(false);
  });
}

// --- BROADCAST LIBRARY ---

async function fetchLibrary(channelId) {
  if (!channelId) return;

  try {
    renderSkeletonLibrary();
    const res = await fetch(`/api/recordings/channel/${channelId}/public`);
    if (!res.ok) throw new Error('Failed to load archive');

    allRecordings = await res.json();
    renderLibrary(allRecordings);
  } catch (e) {
    console.error('[Library] Error:', e);
    libraryContainer.innerHTML = '<div class="schedule-loader">Failed to load archive. Try again soon.</div>';
  }
}

function renderLibrary(recordings) {
  if (!recordings || recordings.length === 0) {
    libraryContainer.innerHTML = '<div class="schedule-loader">No past broadcasts found in the vaults yet.</div>';
    return;
  }

  let html = '';
  recordings.forEach(rec => {
    const dateStr = new Date(rec.created_at).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const sizeMB = (rec.filesize / (1024 * 1024)).toFixed(1);

    html += `
      <div class="recording-item" onclick="playFromArchive('${rec.id}', '${rec.title.replace(/'/g, "\\'")}')">
        <div class="ri-info">
          <div class="ri-title">${rec.title || 'Untitled Broadcast'}</div>
          <div class="ri-meta">
            <span class="ri-date">${dateStr}</span>
            <span class="ri-dot">•</span>
            <span>${sizeMB} MB</span>
          </div>
        </div>
        <div class="ri-play-btn">
          <i data-lucide="play"></i>
        </div>
      </div>
    `;
  });

  libraryContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function toggleLibrary(show) {
  if (show) {
    libraryOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    fetchLibrary(State.channelId);
    updateNavActive(navLibraryBtn);
  } else {
    libraryOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    updateNavActive(navLiveBtn);
  }
}

function stopArchivePlayback() {
  if (archiveAudioPlayer) {
    archiveAudioPlayer.pause();
    archiveAudioPlayer.src = '';
    archiveAudioPlayer.load();
  }
  if (libraryPlayerContainer) {
    libraryPlayerContainer.classList.add('hidden');
  }
  if (returnToRadioBtn) {
    returnToRadioBtn.classList.add('hidden');
  }
  State.isArchivePlaying = false;
  refreshUI();
}

function playFromArchive(id, title) {
  if (!archiveAudioPlayer) return;

  // 1. Properly stop Live radio intent and cleaning up connections
  if (State.intent) {
    console.log('[Archive] Stopping live stream intent to switch to archive');
    stopListening();
  }

  // 2. Suspend live context as a safety measure
  if (audioCtx && audioCtx.state === 'running') {
    audioCtx.suspend();
  }

  State.isArchivePlaying = true;
  refreshUI();

  // 3. Update library player UI
  if (lpTitle) lpTitle.textContent = title;
  if (libraryPlayerContainer) libraryPlayerContainer.classList.remove('hidden');
  if (returnToRadioBtn) returnToRadioBtn.classList.remove('hidden');

  // 4. Set source and play
  archiveAudioPlayer.src = `/api/recordings/${id}/stream`;
  archiveAudioPlayer.load();
  archiveAudioPlayer.play().catch(e => console.error('[Archive] Playback error:', e));

  console.log(`[Archive] Streaming: ${title}`);
  
  // 5. Update Media Session for the archive recording
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: 'OcaTech Archive',
      album: 'Past Broadcast',
      artwork: [
        { src: '/listener/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/listener/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });
  }
}

// Consolidate "Tune In" logic at the bottom or maintain the one at top
// We will remove the duplicate defined around line 1572

// Helper to switch from Archive back to Live Radio
function handleReturnToRadio() {
  haptics('success');
  // 1. Stop archive and hide its UI
  stopArchivePlayback();
  // 2. Resume live radio
  if (!State.intent) {
    startListening();
  } else {
    // If intent was already true, we just need to re-init audio and connect
    initMasterAudio();
    connectToBroadcast();
  }
  // 3. Dismiss overlay
  toggleLibrary(false);
}

if (closeLibraryBtn) {
  closeLibraryBtn.addEventListener('click', () => {
    // If archive is playing, use the return logic. Otherwise just close.
    if (State.isArchivePlaying) {
      handleReturnToRadio();
    } else {
      toggleLibrary(false);
    }
  });
}

if (returnToRadioBtn) {
  returnToRadioBtn.addEventListener('click', () => {
    handleReturnToRadio();
  });
}
// Backdrop click disabled as per user request to force manual closure
// if (libraryOverlay) { ... }

if (librarySearch) {
  librarySearch.addEventListener('input', (e) => {
    const search = e.target.value.toLowerCase();
    const filtered = allRecordings.filter(rec =>
      (rec.title && rec.title.toLowerCase().includes(search)) ||
      (rec.description && rec.description.toLowerCase().includes(search)) ||
      (rec.tags && rec.tags.some(t => t.toLowerCase().includes(search)))
    );
    renderLibrary(filtered);
  });
}

// Global exposure for onclick
window.playFromArchive = playFromArchive;

// --- NATIVE MOBILE UX: PULL TO REFRESH ---
let touchStartPos = 0;
let pullDistance = 0;
const PULL_THRESHOLD = 80;

document.addEventListener('touchstart', (e) => {
  // Only trigger if at the top of the body/main container
  if (window.scrollY <= 5) {
    touchStartPos = e.touches[0].pageY;
  } else {
    touchStartPos = 0;
  }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (touchStartPos === 0 || ptrIndicator.classList.contains('refreshing')) return;

  const currentPos = e.touches[0].pageY;
  pullDistance = currentPos - touchStartPos;

  if (pullDistance > 0) {
    if (pullDistance > 10) {
      ptrIndicator.classList.add('pulling');
      // Limit the visual pull
      const visualPull = Math.min(pullDistance * 0.5, PULL_THRESHOLD + 20);
      ptrIndicator.style.top = `calc(env(safe-area-inset-top) + ${visualPull - 40}px)`;
      ptrIndicator.style.transform = `translateX(-50%) rotate(${pullDistance * 2}deg)`;
    }
  }
}, { passive: true });

document.addEventListener('touchend', () => {
  if (touchStartPos === 0 || ptrIndicator.classList.contains('refreshing')) return;

  if (pullDistance >= PULL_THRESHOLD) {
    refreshContent();
  } else {
    resetPTR();
  }
  touchStartPos = 0;
  pullDistance = 0;
});

async function refreshContent() {
  ptrIndicator.classList.add('refreshing');
  ptrIndicator.style.top = `calc(env(safe-area-inset-top) + 20px)`;
  haptics('success');

  try {
    // Refresh core data
    await Promise.all([
      loadChannels(),
      loadRTCConfig()
    ]);
    
    // Also refresh current overlay if open
    if (!scheduleOverlay.classList.contains('hidden')) {
      await fetchSchedule(State.channelId);
    }
    if (!libraryOverlay.classList.contains('hidden')) {
      await fetchLibrary(State.channelId);
    }
  } catch (e) {
    console.error('[PTR] Refresh failed:', e);
    haptics('error');
  } finally {
    setTimeout(resetPTR, 500);
  }
}

function resetPTR() {
  ptrIndicator.classList.remove('pulling', 'refreshing');
  ptrIndicator.style.top = `calc(env(safe-area-inset-top) - 40px)`;
  ptrIndicator.style.transform = `translateX(-50%) rotate(0deg)`;
}

// --- PWA INSTALLATION LOGIC ---
let deferredPrompt;
const installPrompt = document.getElementById('pwa-install-prompt');
const installBtn = document.getElementById('pwa-install-btn');
const closeInstallBtn = document.getElementById('pwa-close-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome from showing the default mini-infobar
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  
  // Only show the prompt if the user hasn't dismissed it in this session
  if (!sessionStorage.getItem('pwa_dismissed')) {
    setTimeout(() => {
      if (installPrompt) installPrompt.classList.remove('hidden');
    }, 5000); // Wait 5s before showing
  }
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    haptics('medium');
    installPrompt.classList.add('hidden');
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install choice: ${outcome}`);
    deferredPrompt = null;
  });
}

if (closeInstallBtn) {
  closeInstallBtn.addEventListener('click', () => {
    haptics('light');
    installPrompt.classList.add('hidden');
    sessionStorage.setItem('pwa_dismissed', 'true');
  });
}

window.addEventListener('appinstalled', () => {
  console.log('[PWA] OcaTech installed successfully!');
  if (installPrompt) installPrompt.classList.add('hidden');
});

// --- BOTTOM SHEET DRAG-TO-DISMISS LOGIC ---
function initBottomSheetDraggable(el, closeFn, handleSelector = '.sheet-handle') {
  const handle = el.querySelector(handleSelector);
  if (!handle) return;

  let startY = 0;
  let currentY = 0;
  let pulling = false;

  handle.addEventListener('touchstart', (e) => {
    startY = e.touches[0].pageY;
    pulling = true;
    el.style.transition = 'none';
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    currentY = e.touches[0].pageY;
    const deltaY = currentY - startY;
    
    // Only allow pulling down
    if (deltaY > 0) {
      el.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: true });

  handle.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    
    const deltaY = currentY - startY;
    el.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    
    // If pulled down more than 150px, dismiss it
    if (deltaY > 150) {
      el.style.transform = 'translateY(100%)';
      setTimeout(() => {
        closeFn();
        el.style.transform = '';
      }, 300);
    } else {
      // Snap back
      el.style.transform = '';
    }
    
    startY = 0;
    currentY = 0;
  });
}

// Initialize for all mobile bottom sheets
if (window.innerWidth <= 768) {
  // Chat Panel
  initBottomSheetDraggable(chatPanel, () => {
    chatPanel.classList.remove('open');
    updateNavActive(navLiveBtn);
  });

  // Schedule Overlay
  const scheduleContent = scheduleOverlay.querySelector('.overlay-content');
  if (scheduleContent) {
    initBottomSheetDraggable(scheduleContent, () => toggleSchedule(false));
  }

  // Library Overlay
  const libraryContent = libraryOverlay.querySelector('.overlay-content');
  if (libraryContent) {
    initBottomSheetDraggable(libraryContent, () => {
      if (State.isArchivePlaying) {
        handleReturnToRadio();
      } else {
        toggleLibrary(false);
      }
    });
  }
}
// --- SKELETON LOADERS ---
function renderSkeletonChannels() {
  if (!channelList) return;
  channelList.innerHTML = Array(3).fill(0).map(() => `
    <div class="channel-card skeleton" style="border:none; height:45px; min-width:120px; opacity: 0.5;"></div>
  `).join('');
}

function renderSkeletonSchedule() {
  if (!scheduleContainer) return;
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `
      <div class="slot-item" style="border:none; background:rgba(255,255,255,0.02); pointer-events:none; margin-bottom:8px;">
        <div class="skeleton" style="width: 50px; height: 35px; border-radius: 8px;"></div>
        <div class="slot-info" style="flex:1; margin: 0 15px;">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton skeleton-circle" style="opacity:0.3;"></div>
      </div>
    `;
  }
  scheduleContainer.innerHTML = html;
}

function renderSkeletonLibrary() {
  if (!libraryContainer) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    html += `
      <div class="recording-item" style="border:none; background:rgba(255,255,255,0.02); pointer-events:none; margin-bottom:8px;">
        <div class="ri-info" style="flex:1;">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton skeleton-circle" style="opacity:0.3;"></div>
      </div>
    `;
  }
  libraryContainer.innerHTML = html;
}
