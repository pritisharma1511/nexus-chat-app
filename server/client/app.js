/**
 * NexusChat — Real-Time Frontend Logic
 */

(function () {
  'use strict';

  // Application State
  const state = {
    token: sessionStorage.getItem('nexus_token') || null,
    user: null,
    currentRoom: 'general',
    rooms: ['general', 'random', 'tech'],
    onlineUsers: [],
    socket: null,
    isTyping: false,
    typingTimer: null,
    authMode: 'login' // 'login' or 'register'
  };

  // DOM Elements Cache
  const el = {
    toastContainer: document.getElementById('toast-container'),
    authView: document.getElementById('auth-view'),
    chatView: document.getElementById('chat-view'),
    tabLogin: document.getElementById('tab-login'),
    tabRegister: document.getElementById('tab-register'),
    authForm: document.getElementById('auth-form'),
    authUsername: document.getElementById('auth-username'),
    authPassword: document.getElementById('auth-password'),
    authSubmitBtn: document.getElementById('auth-submit-btn'),
    authBtnText: document.getElementById('auth-btn-text'),
    authSpinner: document.getElementById('auth-spinner'),
    authError: document.getElementById('auth-error'),
    authSuccess: document.getElementById('auth-success'),
    instanceHostname: document.getElementById('instance-hostname'),
    headerRoomName: document.getElementById('header-room-name'),
    userNameDisplay: document.getElementById('user-name-display'),
    userAvatarInitial: document.getElementById('user-avatar-initial'),
    onlineCountBadge: document.getElementById('online-count-badge'),
    presenceCountPill: document.getElementById('presence-count-pill'),
    logoutBtn: document.getElementById('logout-btn'),
    channelsList: document.getElementById('channels-list'),
    channelsCount: document.getElementById('channels-count'),
    presenceList: document.getElementById('presence-list'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    messagesContainer: document.getElementById('messages-container'),
    roomWelcomeBanner: document.getElementById('room-welcome-banner'),
    welcomeRoomTitle: document.getElementById('welcome-room-title'),
    welcomeRoomName: document.getElementById('welcome-room-name'),
    typingIndicatorBar: document.getElementById('typing-indicator-bar'),
    typingText: document.getElementById('typing-text'),
    messageForm: document.getElementById('message-form'),
    messageInput: document.getElementById('message-input'),
    charCount: document.getElementById('char-count'),
    sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
    usersToggleBtn: document.getElementById('users-toggle-btn'),
    channelsSidebar: document.getElementById('channels-sidebar'),
    presenceSidebar: document.getElementById('presence-sidebar')
  };

  // ==========================================================================
  // Toast Notifications
  // ==========================================================================

  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close toast');
    closeBtn.onclick = () => removeToast(toast);

    toast.appendChild(msgSpan);
    toast.appendChild(closeBtn);
    el.toastContainer.appendChild(toast);

    const timer = setTimeout(() => {
      removeToast(toast);
    }, duration);

    toast._timer = timer;
  }

  function removeToast(toast) {
    clearTimeout(toast._timer);
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }

  // ==========================================================================
  // Auth Functions
  // ==========================================================================

  function setAuthMode(mode) {
    state.authMode = mode;
    el.authError.classList.add('hidden');
    el.authSuccess.classList.add('hidden');

    if (mode === 'login') {
      el.tabLogin.classList.add('active');
      el.tabLogin.setAttribute('aria-selected', 'true');
      el.tabRegister.classList.remove('active');
      el.tabRegister.setAttribute('aria-selected', 'false');
      el.authBtnText.textContent = 'Sign In';
    } else {
      el.tabRegister.classList.add('active');
      el.tabRegister.setAttribute('aria-selected', 'true');
      el.tabLogin.classList.remove('active');
      el.tabLogin.setAttribute('aria-selected', 'false');
      el.authBtnText.textContent = 'Create Account';
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const username = el.authUsername.value.trim();
    const password = el.authPassword.value;

    el.authError.classList.add('hidden');
    el.authSuccess.classList.add('hidden');

    if (!username || !password) {
      el.authError.textContent = 'Please fill in all fields.';
      el.authError.classList.remove('hidden');
      return;
    }

    setAuthLoading(true);

    const endpoint = state.authMode === 'login' ? '/api/login' : '/api/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        el.authError.textContent = data.error || 'Authentication failed.';
        el.authError.classList.remove('hidden');
        setAuthLoading(false);
        return;
      }

      state.token = data.token;
      state.user = data.user;
      sessionStorage.setItem('nexus_token', data.token);

      el.authSuccess.textContent = state.authMode === 'login' ? 'Signed in! Connecting...' : 'Account created! Connecting...';
      el.authSuccess.classList.remove('hidden');

      setTimeout(() => {
        setAuthLoading(false);
        transitionToChat();
      }, 500);
    } catch (err) {
      el.authError.textContent = 'Network error connecting to authentication server.';
      el.authError.classList.remove('hidden');
      setAuthLoading(false);
    }
  }

  function setAuthLoading(isLoading) {
    el.authSubmitBtn.disabled = isLoading;
    if (isLoading) {
      el.authSpinner.classList.remove('hidden');
      el.authBtnText.classList.add('hidden');
    } else {
      el.authSpinner.classList.add('hidden');
      el.authBtnText.classList.remove('hidden');
    }
  }

  async function verifyExistingSession() {
    if (!state.token) return;

    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${state.token}` }
      });

      if (res.ok) {
        const data = await res.json();
        state.user = data.user;
        transitionToChat();
      } else {
        sessionStorage.removeItem('nexus_token');
        state.token = null;
      }
    } catch (err) {
      sessionStorage.removeItem('nexus_token');
      state.token = null;
    }
  }

  function logout() {
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    sessionStorage.removeItem('nexus_token');
    state.token = null;
    state.user = null;

    el.chatView.classList.add('hidden');
    el.authView.classList.remove('hidden');
    el.authPassword.value = '';
    el.authError.classList.add('hidden');
    el.authSuccess.classList.add('hidden');
    showToast('You have been logged out.', 'info');
  }

  // ==========================================================================
  // Chat View & Socket Connection
  // ==========================================================================

  function transitionToChat() {
    el.authView.classList.add('hidden');
    el.chatView.classList.remove('hidden');

    const username = state.user?.username || 'user';
    el.userNameDisplay.textContent = username;
    el.userAvatarInitial.textContent = username.charAt(0).toUpperCase();

    initSocket();
    fetchRooms();
  }

  async function fetchRooms() {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rooms) && data.rooms.length > 0) {
          state.rooms = data.rooms;
          renderChannels();
        }
      }
    } catch (err) {
      console.warn('Could not fetch room list:', err);
    }
  }

  function initSocket() {
    if (state.socket) {
      state.socket.disconnect();
    }

    state.socket = io({
      auth: { token: state.token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    state.socket.on('connect', () => {
      updateStatus(true);
      showToast('Connected to chat server', 'success', 2500);

      // Join the active room
      joinRoom(state.currentRoom);

      // Check server health to fetch container instance hostname
      fetch('/health')
        .then(r => r.json())
        .then(data => {
          if (data && data.hostname) {
            el.instanceHostname.textContent = `Node: ${data.hostname}`;
          }
        })
        .catch(() => {});
    });

    state.socket.on('disconnect', (reason) => {
      updateStatus(false, 'Reconnecting...');
      if (reason === 'io server disconnect') {
        // the server forcefully disconnected the socket (e.g., token expired)
        state.socket.connect();
      }
    });

    state.socket.on('connect_error', (err) => {
      updateStatus(false, 'Disconnected');
      if (err.message && err.message.includes('Authentication error')) {
        showToast('Session expired. Please log in again.', 'error');
        logout();
      }
    });

    // Room History
    state.socket.on('room:history', (history) => {
      renderHistory(history);
    });

    // New Incoming Message
    state.socket.on('message:new', (msg) => {
      appendMessage(msg);
      scrollToBottom();
    });

    // Presence Updates
    state.socket.on('presence:update', (data) => {
      if (data.room === state.currentRoom) {
        state.onlineUsers = data.users || [];
        renderPresence();
      }
    });

    // Typing Indicators
    state.socket.on('typing', (data) => {
      if (data.room === state.currentRoom) {
        handleTypingEvent(data);
      }
    });

    // Rate Limit Warnings
    state.socket.on('error:rate_limit', (err) => {
      showToast(err.message || `Rate limit exceeded. Wait ${err.retryAfter || 10}s.`, 'warning', 5000);
    });

    // Validation Errors
    state.socket.on('error:validation', (err) => {
      showToast(err.message || 'Validation error.', 'error');
    });
  }

  function updateStatus(isOnline, text = 'Connected') {
    if (isOnline) {
      el.statusIndicator.className = 'status-indicator online';
      el.statusText.textContent = 'Connected';
    } else {
      el.statusIndicator.className = 'status-indicator offline';
      el.statusText.textContent = text;
    }
  }

  function joinRoom(room) {
    state.currentRoom = room;
    el.headerRoomName.textContent = room;
    el.welcomeRoomTitle.textContent = `Welcome to #${room}!`;
    el.welcomeRoomName.textContent = `#${room}`;
    el.messageInput.placeholder = `Message #${room}... (Enter to send)`;

    // Clear previous messages
    el.messagesContainer.innerHTML = '';

    // Emit join
    state.socket.emit('room:join', { room });
    renderChannels();
  }

  function switchRoom(newRoom) {
    if (newRoom === state.currentRoom) return;

    if (state.socket) {
      state.socket.emit('room:leave', { room: state.currentRoom });
    }
    joinRoom(newRoom);
  }

  // ==========================================================================
  // Renderers (Strict XSS Prevention via textContent)
  // ==========================================================================

  function renderChannels() {
    el.channelsList.innerHTML = '';
    el.channelsCount.textContent = state.rooms.length;

    state.rooms.forEach((room) => {
      const item = document.createElement('div');
      item.className = `channel-item ${room === state.currentRoom ? 'active' : ''}`;
      item.setAttribute('role', 'button');
      item.onclick = () => switchRoom(room);

      const hash = document.createElement('span');
      hash.className = 'channel-hash';
      hash.textContent = '#';

      const name = document.createElement('span');
      name.className = 'channel-name';
      name.textContent = room;

      item.appendChild(hash);
      item.appendChild(name);
      el.channelsList.appendChild(item);
    });
  }

  function renderPresence() {
    el.presenceList.innerHTML = '';
    const count = state.onlineUsers.length;
    el.onlineCountBadge.textContent = count;
    el.presenceCountPill.textContent = count;

    state.onlineUsers.forEach((username) => {
      const item = document.createElement('div');
      item.className = 'presence-item';

      const dot = document.createElement('span');
      dot.className = 'presence-indicator';

      const name = document.createElement('span');
      name.className = 'presence-name';
      name.textContent = username;
      if (state.user && username === state.user.username) {
        name.textContent += ' (you)';
      }

      item.appendChild(dot);
      item.appendChild(name);
      el.presenceList.appendChild(item);
    });
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendMessage(msg) {
    const card = document.createElement('div');
    const isSelf = state.user && msg.user === state.user.username;
    card.className = `message-card ${isSelf ? 'is-self' : ''}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = (msg.user || '?').charAt(0).toUpperCase();

    // Content wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    // Header (Author, Time, Host Tag)
    const header = document.createElement('div');
    header.className = 'message-header';

    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = msg.user || 'Unknown';

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatTimestamp(msg.ts);

    header.appendChild(author);
    header.appendChild(time);

    // Host tag to visibly show container instance in scaled environment
    if (msg.hostname) {
      const hostTag = document.createElement('span');
      hostTag.className = 'message-host-tag';
      hostTag.textContent = msg.hostname;
      hostTag.title = 'Originating container instance';
      header.appendChild(hostTag);
    }

    // Message Text (strict textContent to avoid XSS)
    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = msg.text || '';

    wrapper.appendChild(header);
    wrapper.appendChild(body);

    card.appendChild(avatar);
    card.appendChild(wrapper);

    el.messagesContainer.appendChild(card);
  }

  function renderHistory(history) {
    el.messagesContainer.innerHTML = '';
    if (Array.isArray(history)) {
      history.forEach((msg) => appendMessage(msg));
    }
    scrollToBottom();
  }

  function scrollToBottom() {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  }

  // ==========================================================================
  // Message Sending & Typing Indicators
  // ==========================================================================

  function handleMessageSubmit(e) {
    e.preventDefault();
    const text = el.messageInput.value.trim();
    if (!text || !state.socket) return;

    state.socket.emit('message:send', {
      room: state.currentRoom,
      text: text
    });

    el.messageInput.value = '';
    el.charCount.textContent = '0 / 1000';

    // Stop typing indicator immediately
    if (state.isTyping) {
      state.isTyping = false;
      clearTimeout(state.typingTimer);
      state.socket.emit('typing:stop', { room: state.currentRoom });
    }

    el.messageInput.focus();
  }

  function handleTypingInput() {
    const len = el.messageInput.value.length;
    el.charCount.textContent = `${len} / 1000`;

    if (!state.socket) return;

    if (!state.isTyping && len > 0) {
      state.isTyping = true;
      state.socket.emit('typing:start', { room: state.currentRoom });
    }

    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      if (state.isTyping) {
        state.isTyping = false;
        state.socket.emit('typing:stop', { room: state.currentRoom });
      }
    }, 1500);
  }

  const activeTypers = new Set();
  function handleTypingEvent(data) {
    if (data.user === state.user?.username) return;

    if (data.isTyping) {
      activeTypers.add(data.user);
    } else {
      activeTypers.delete(data.user);
    }

    if (activeTypers.size > 0) {
      const typersArray = Array.from(activeTypers);
      let text = '';
      if (typersArray.length === 1) {
        text = `${typersArray[0]} is typing...`;
      } else if (typersArray.length === 2) {
        text = `${typersArray[0]} and ${typersArray[1]} are typing...`;
      } else {
        text = 'Multiple people are typing...';
      }
      el.typingText.textContent = text;
      el.typingIndicatorBar.classList.add('visible');
    } else {
      el.typingIndicatorBar.classList.remove('visible');
    }
  }

  // ==========================================================================
  // Event Listeners Registration
  // ==========================================================================

  function setupEventListeners() {
    el.tabLogin.addEventListener('click', () => setAuthMode('login'));
    el.tabRegister.addEventListener('click', () => setAuthMode('register'));
    el.authForm.addEventListener('submit', handleAuthSubmit);
    el.logoutBtn.addEventListener('click', logout);
    el.messageForm.addEventListener('submit', handleMessageSubmit);
    el.messageInput.addEventListener('input', handleTypingInput);

    // Responsive Drawer Toggles
    el.sidebarToggleBtn.addEventListener('click', () => {
      el.channelsSidebar.classList.toggle('open');
      el.presenceSidebar.classList.remove('open');
    });

    el.usersToggleBtn.addEventListener('click', () => {
      el.presenceSidebar.classList.toggle('open');
      el.channelsSidebar.classList.remove('open');
    });

    // Close drawers when clicking in chat area on mobile
    el.messagesContainer.addEventListener('click', () => {
      el.channelsSidebar.classList.remove('open');
      el.presenceSidebar.classList.remove('open');
    });
  }

  // Initialization
  setupEventListeners();
  verifyExistingSession();
})();
