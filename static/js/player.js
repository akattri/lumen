/**
 * CALALOG — Custom YouTube Video Player Engine
 * Pure Vanilla JavaScript
 * Features:
 * - PostMessage HTML5 embedded YouTube control (no external fragile SDK needed)
 * - Hold-to-2× playback (Spacebar hold & touch/click hold)
 * - Exact-second resume from last saved timestamp
 * - Reliable background autosave (interval, pause, end, sendBeacon/pagehide)
 * - Chapter-segmented interactive seekbar with hover tooltips
 * - Keyboard shortcuts (Space, K, J, L, ArrowLeft, ArrowRight, F, M, 0)
 * - Fullscreen toggle
 * - Auto-advance queue on completion
 */

class CalalogPlayer {
  constructor(options = {}) {
    this.container = typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container;

    if (!this.container) {
      console.warn('CalalogPlayer: Container element not found');
      return;
    }

    this.video = options.video || null;
    this.chapters = options.chapters || [];
    this.onProgress = options.onProgress || null;
    this.onEnded = options.onEnded || null;
    this.onChapterChange = options.onChapterChange || null;
    this.playerVars = Object.assign({ controls: 0 }, options.playerVars || {});

    // Timing & State
    this.isPlaying = false;
    this.currentTime = this.video ? Math.max(0, Math.floor(this.video.current_time || 0)) : 0;
    this.duration = this.video ? (this.video.duration || 0) : 0;
    this.playbackRate = this.video ? (this.video.playback_rate || 1) : 1;
    this.savedPlaybackRate = this.playbackRate;
    this.volume = 100;
    this.isMuted = false;
    this.isFullscreen = false;
    this.isSpeedBoosted = false;
    this.hasStartedPlaying = false;
    this.initialSeekDone = false;

    // Subtitles / Closed Captions (CC) State
    this.isCaptionsOn = false;
    this.captionsAvailable = false;
    this.captionTracks = [];
    this.currentCaptionTrack = null;
    this.lastUserCaptionToggleTime = 0;

    // Timers & tracking
    this.saveInterval = null;
    this.controlsTimer = null;
    this.tickerInterval = null;
    this.spacePressStart = null;
    this.isHoldingSpace = false;
    this.isDraggingSeek = false;

    // DOM Elements
    this.iframe = this.container.querySelector('#youtube-player-iframe');
    this.clickSurface = this.container.querySelector('#player-click-surface');
    this.controlsDeck = this.container.querySelector('#player-controls-deck');
    this.playPauseBtn = this.container.querySelector('#player-play-pause-btn');
    this.rewindBtn = this.container.querySelector('#player-rewind-btn');
    this.forwardBtn = this.container.querySelector('#player-forward-btn');
    this.ccBtn = this.container.querySelector('#player-cc-btn');
    this.volumeBtn = this.container.querySelector('#player-volume-btn');
    this.volumeSlider = this.container.querySelector('#player-volume-slider');
    this.currentTimeEl = this.container.querySelector('#player-current-time');
    this.durationEl = this.container.querySelector('#player-duration');
    this.speedBtn = this.container.querySelector('#player-speed-btn');
    this.speedMenu = this.container.querySelector('#player-speed-menu');
    this.fullscreenBtn = this.container.querySelector('#player-fullscreen-btn');
    this.hold2xBtn = this.container.querySelector('#player-hold-2x-btn');
    this.speedBoostBanner = this.container.querySelector('#speed-boost-banner');
    this.hudFlashOverlay = this.container.querySelector('#hud-flash-overlay');
    this.activeChapterBadge = this.container.querySelector('#active-chapter-badge');
    this.resumePill = this.container.querySelector('#resume-pill');
    this.restartBtn = this.container.querySelector('#resume-restart-btn');

    // Seek bar DOM
    this.seekBarWrapper = this.container.querySelector('#seek-bar-wrapper');
    this.seekBarTrack = this.container.querySelector('#seek-bar-track');
    this.seekPlayhead = this.container.querySelector('#seek-playhead');
    this.seekTooltip = this.container.querySelector('#seek-tooltip');

    this.init();
  }

  init() {
    this.bindEvents();
    this.setupPostMessageListener();
    this.buildChapterSegments();
    this.updateTimeDisplay();
    this.updateCaptionsUI();

    // Start listening ping to iframe
    this.startListeningPing();
  }

  // --- PostMessage YouTube Controller ---

  setupPostMessageListener() {
    window.addEventListener('message', (event) => {
      try {
        let data = event.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            return;
          }
        }
        if (!data || typeof data !== 'object') return;

        // onReady
        if (data.event === 'onReady') {
          this.postCommand('loadModule', ['captions']);
          this.postCommand('loadModule', ['cc']);
          if (this.currentTime > 2 && !this.initialSeekDone) {
            this.initialSeekDone = true;
            this.seekTo(this.currentTime, true);
          }
        }

        // onApiChange
        if (data.event === 'onApiChange') {
          this.postCommand('loadModule', ['captions']);
        }

        // apiInfoDelivery (captions module status, tracklist, and active track)
        if (data.event === 'apiInfoDelivery' && data.info) {
          if (data.info.captions) {
            const caps = data.info.captions;
            if (Array.isArray(caps.tracklist)) {
              this.captionTracks = caps.tracklist;
              this.captionsAvailable = caps.tracklist.length > 0;
            }
            if (caps.track && typeof caps.track === 'object') {
              const hasTrack = !!(caps.track.languageCode || caps.track.displayName || caps.track.vss_id);
              if (Date.now() - this.lastUserCaptionToggleTime > 1200) {
                this.isCaptionsOn = hasTrack;
              }
              if (hasTrack) {
                this.currentCaptionTrack = caps.track;
              }
            }
            this.updateCaptionsUI();
          } else if (Array.isArray(data.info.namespaces) && !data.info.namespaces.includes('captions')) {
            this.captionsAvailable = false;
            this.updateCaptionsUI();
          }
        }

        // onStateChange (1: playing, 2: paused, 0: ended)
        if (data.event === 'onStateChange') {
          const state = typeof data.info === 'number' ? data.info : data.info?.playerState;
          if (typeof state === 'number') {
            this.handleStateChange(state);
            if (state === 1 && (!this.captionTracks || !this.captionTracks.length)) {
              this.postCommand('loadModule', ['captions']);
            }
          }
        }

        // infoDelivery & initialDelivery
        if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && data.info) {
          const info = data.info;
          if (Array.isArray(info.captionTracks)) {
            this.captionTracks = info.captionTracks;
            this.captionsAvailable = info.captionTracks.length > 0;
            this.updateCaptionsUI();
          }
          if (typeof info.playerState === 'number') {
            this.handleStateChange(info.playerState);
          }
          if (typeof info.currentTime === 'number' && Math.abs(info.currentTime - this.currentTime) > 1.2) {
            this.currentTime = info.currentTime;
            this.updateTimeDisplay();
          }
          if (typeof info.duration === 'number' && info.duration > 0 && Math.abs(info.duration - this.duration) > 1) {
            this.duration = info.duration;
            this.buildChapterSegments();
            this.updateTimeDisplay();
          }
        }
      } catch (e) {
        // ignore
      }
    });
  }

  startListeningPing() {
    const ping = () => {
      if (this.iframe && this.iframe.contentWindow) {
        try {
          this.iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*');
        } catch (e) {}
      }
    };
    ping();
    this.pingInterval = setInterval(ping, 1500);
  }

  postCommand(func, args = []) {
    if (!this.iframe || !this.iframe.contentWindow) return;
    try {
      this.iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func,
        args
      }), '*');
    } catch (e) {
      console.warn('postCommand failed:', e);
    }
  }

  // --- Playback State Changes ---

  handleStateChange(state) {
    if (state === 1) { // PLAYING
      this.isPlaying = true;
      this.hasStartedPlaying = true;
      if (this.resumePill) this.resumePill.style.display = 'none';
      this.updatePlayPauseButton();
      this.startProgressSaveLoop();
      this.startLocalTicker();
      this.resetControlsTimeout();

      // Ensure initial resume seek was applied
      if (this.currentTime > 2 && !this.initialSeekDone) {
        this.initialSeekDone = true;
        this.seekTo(this.currentTime, true);
      }
    } else if (state === 2) { // PAUSED
      this.isPlaying = false;
      this.updatePlayPauseButton();
      this.stopProgressSaveLoop();
      this.stopLocalTicker();
      this.saveProgressNow();
      this.showControls();
    } else if (state === 0) { // ENDED
      this.isPlaying = false;
      this.updatePlayPauseButton();
      this.stopProgressSaveLoop();
      this.stopLocalTicker();
      this.saveProgressNow(true);
      this.showControls();
      if (typeof this.onEnded === 'function') {
        this.onEnded(this.video);
      }
    }
  }

  // --- Core Player Actions ---

  play() {
    this.hasStartedPlaying = true;
    if (this.resumePill) this.resumePill.style.display = 'none';

    if (this.currentTime > 2 && !this.initialSeekDone) {
      this.initialSeekDone = true;
      this.seekTo(this.currentTime, true);
    }

    this.postCommand('playVideo');
    this.isPlaying = true;
    this.updatePlayPauseButton();
    this.triggerFlash('play');
    this.resetControlsTimeout();
    this.startProgressSaveLoop();
    this.startLocalTicker();
  }

  pause() {
    this.postCommand('pauseVideo');
    this.isPlaying = false;
    this.updatePlayPauseButton();
    this.triggerFlash('pause');
    this.stopProgressSaveLoop();
    this.stopLocalTicker();
    this.saveProgressNow();
    this.showControls();
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seekRelative(offsetSeconds) {
    this.hasStartedPlaying = true;
    const dur = this.duration || 3600;
    const target = Math.max(0, Math.min(dur, this.currentTime + offsetSeconds));
    this.seekTo(target);
    this.triggerFlash(offsetSeconds > 0 ? '+10s' : '-10s');
  }

  seekTo(seconds, allowSeekAhead = true) {
    const dur = this.duration || 3600;
    const clamped = Math.max(0, Math.min(dur, seconds));
    this.currentTime = clamped;
    this.postCommand('seekTo', [clamped, allowSeekAhead]);
    this.updateTimeDisplay();
    this.resetControlsTimeout();
    this.saveProgressNow();
  }

  // --- HOLD-TO-2X SPEED BOOST FEATURE ---

  startSpeedBoost() {
    if (this.isSpeedBoosted) return;
    this.isSpeedBoosted = true;
    this.postCommand('setPlaybackRate', [2]);

    if (this.speedBoostBanner) {
      this.speedBoostBanner.style.display = 'flex';
    }
    if (this.hold2xBtn) {
      this.hold2xBtn.classList.add('active');
    }
  }

  endSpeedBoost() {
    if (!this.isSpeedBoosted) return;
    this.isSpeedBoosted = false;
    this.postCommand('setPlaybackRate', [this.savedPlaybackRate || 1]);

    if (this.speedBoostBanner) {
      this.speedBoostBanner.style.display = 'none';
    }
    if (this.hold2xBtn) {
      this.hold2xBtn.classList.remove('active');
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    this.savedPlaybackRate = rate;
    this.postCommand('setPlaybackRate', [rate]);
    if (this.speedBtn) {
      const span = this.speedBtn.querySelector('span');
      if (span) span.textContent = `${rate}×`;
    }
    if (this.speedMenu) {
      this.speedMenu.classList.remove('show');
      this.speedMenu.querySelectorAll('.speed-option').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.rate) === rate);
      });
    }
  }

  toggleMute() {
    if (this.isMuted) {
      this.isMuted = false;
      this.postCommand('unMute');
      this.postCommand('setVolume', [this.volume || 100]);
    } else {
      this.isMuted = true;
      this.postCommand('mute');
    }
    this.updateVolumeUI();
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(100, val));
    if (this.volume === 0) {
      this.isMuted = true;
      this.postCommand('mute');
    } else {
      if (this.isMuted) {
        this.isMuted = false;
        this.postCommand('unMute');
      }
      this.postCommand('setVolume', [this.volume]);
    }
    this.updateVolumeUI();
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        if (this.container.requestFullscreen) {
          await this.container.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (e) {
      console.warn('Fullscreen error:', e);
    }
  }

  // --- Subtitles / Closed Captions (CC) ---

  toggleCaptions() {
    if (!this.captionsAvailable) return;
    if (this.isCaptionsOn) {
      this.disableCaptions();
    } else {
      this.enableCaptions();
    }
  }

  enableCaptions() {
    this.isCaptionsOn = true;
    this.lastUserCaptionToggleTime = Date.now();
    this.postCommand('loadModule', ['captions']);
    this.postCommand('loadModule', ['cc']);

    const track = this.currentCaptionTrack ||
      (this.captionTracks && this.captionTracks.length > 0
        ? (this.captionTracks.find(t => t.languageCode === 'en' || (t.languageCode && t.languageCode.startsWith('en'))) || this.captionTracks[0])
        : { languageCode: 'en' });

    const trackPayload = track.languageCode ? { languageCode: track.languageCode } : { languageCode: 'en' };
    this.currentCaptionTrack = track;
    this.postCommand('setOption', ['captions', 'track', trackPayload]);
    this.updateCaptionsUI();
    this.triggerFlash('cc-on');
    this.resetControlsTimeout();
  }

  disableCaptions() {
    this.isCaptionsOn = false;
    this.lastUserCaptionToggleTime = Date.now();
    this.postCommand('setOption', ['captions', 'track', {}]);
    this.updateCaptionsUI();
    this.triggerFlash('cc-off');
    this.resetControlsTimeout();
  }

  updateCaptionsUI() {
    if (!this.ccBtn) return;

    if (this.captionsAvailable === false) {
      this.ccBtn.disabled = true;
      this.ccBtn.classList.add('disabled');
      this.ccBtn.classList.remove('active');
      this.ccBtn.title = "Subtitles unavailable";
      this.ccBtn.setAttribute('aria-disabled', 'true');
      return;
    }

    this.ccBtn.disabled = false;
    this.ccBtn.classList.remove('disabled');
    this.ccBtn.removeAttribute('aria-disabled');

    if (this.isCaptionsOn) {
      this.ccBtn.classList.add('active');
      this.ccBtn.title = "Turn off subtitles (C)";
      this.ccBtn.setAttribute('aria-pressed', 'true');
    } else {
      this.ccBtn.classList.remove('active');
      this.ccBtn.title = "Turn on subtitles (C)";
      this.ccBtn.setAttribute('aria-pressed', 'false');
    }
  }

  // --- YouTube IFrame API Compatibility Helpers ---

  loadModule(module) {
    this.postCommand('loadModule', [module]);
  }

  unloadModule(module) {
    this.postCommand('unloadModule', [module]);
  }

  setOption(module, option, val) {
    this.postCommand('setOption', [module, option, val]);
    if (module === 'captions' && option === 'track') {
      if (!val || (typeof val === 'object' && Object.keys(val).length === 0)) {
        this.isCaptionsOn = false;
      } else {
        this.isCaptionsOn = true;
        this.currentCaptionTrack = val;
      }
      this.updateCaptionsUI();
    }
  }

  getOption(module, option) {
    if (module === 'captions') {
      if (option === 'track') {
        return this.isCaptionsOn ? (this.currentCaptionTrack || (this.captionTracks[0] || {})) : {};
      }
      if (option === 'tracklist') {
        return this.captionTracks || [];
      }
      if (option === 'fontSize') {
        return 0;
      }
    }
    return null;
  }

  getOptions(module) {
    if (!module) {
      return this.captionsAvailable ? ['captions'] : [];
    }
    if (module === 'captions') {
      return ['fontSize', 'reload', 'track', 'tracklist', 'translationLanguages'];
    }
    return [];
  }

  // --- Smooth Local Progress Ticker ---

  startLocalTicker() {
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    const intervalMs = 200;

    this.tickerInterval = setInterval(() => {
      if (!this.isPlaying) return;
      const rate = this.isSpeedBoosted ? 2 : this.playbackRate;
      const advance = (intervalMs / 1000) * rate;
      const dur = this.duration || 3600;
      this.currentTime = Math.min(dur, this.currentTime + advance);
      this.updateTimeDisplay();

      // Check for completion
      if (dur > 0 && this.currentTime >= dur - 0.5) {
        this.handleStateChange(0);
      }
    }, intervalMs);
  }

  stopLocalTicker() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  // --- Progress Persistence ---

  startProgressSaveLoop() {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveInterval = setInterval(() => {
      this.saveProgressNow();
    }, 2800);
  }

  stopProgressSaveLoop() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  saveProgressNow(isCompleted = false) {
    if (!this.video) return;

    const time = Math.max(0, Math.floor(this.currentTime));
    const dur = Math.max(1, Math.floor(this.duration || this.video.duration || 1));
    const pct = Math.min(100, Math.round((time / dur) * 100));
    const status = isCompleted || pct >= 95 ? 'completed' : time > 5 ? 'in-progress' : 'unwatched';

    const payload = {
      currentTime: time,
      duration: dur,
      progressPercentage: pct,
      status: status,
      playbackRate: this.playbackRate
    };

    // Save via fetch API
    fetch(`/api/library/${this.video.id}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.warn('Progress save failed:', err));

    if (typeof this.onProgress === 'function') {
      this.onProgress(this.video.id, payload);
    }
  }

  saveProgressOnUnload() {
    if (!this.video || this.currentTime <= 0) return;

    const time = Math.max(0, Math.floor(this.currentTime));
    const dur = Math.max(1, Math.floor(this.duration || this.video.duration || 1));
    const pct = Math.min(100, Math.round((time / dur) * 100));
    const status = pct >= 95 ? 'completed' : time > 5 ? 'in-progress' : 'unwatched';

    const payload = JSON.stringify({
      currentTime: time,
      duration: dur,
      progressPercentage: pct,
      status: status,
      playbackRate: this.playbackRate
    });

    const url = `/api/library/${this.video.id}/progress`;
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      });
    }
  }

  // --- UI Update Helpers ---

  updatePlayPauseButton() {
    if (!this.playPauseBtn) return;
    if (this.isPlaying) {
      this.playPauseBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      `;
      this.playPauseBtn.title = "Pause (Space / K)";
    } else {
      this.playPauseBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-left: 2px;">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;
      this.playPauseBtn.title = "Play (Space / K)";
    }
  }

  updateVolumeUI() {
    if (this.volumeSlider) {
      this.volumeSlider.value = this.isMuted ? 0 : this.volume;
    }
    if (this.volumeBtn) {
      if (this.isMuted || this.volume === 0) {
        this.volumeBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #F87171;">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          </svg>
        `;
      } else if (this.volume < 50) {
        this.volumeBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        `;
      } else {
        this.volumeBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        `;
      }
    }
  }

  updateTimeDisplay() {
    if (this.currentTimeEl) {
      this.currentTimeEl.textContent = this.formatTime(this.currentTime);
    }
    if (this.durationEl) {
      this.durationEl.textContent = this.formatTime(this.duration || (this.video ? this.video.duration : 0));
    }

    // Update playhead on seekbar
    const dur = this.duration || 1;
    const pct = Math.min(100, Math.max(0, (this.currentTime / dur) * 100));
    if (this.seekPlayhead) {
      this.seekPlayhead.style.left = `${pct}%`;
    }

    // Update chapter segment progress fills
    if (this.seekBarTrack) {
      const segments = this.seekBarTrack.querySelectorAll('.chapter-segment');
      segments.forEach(seg => {
        const start = parseFloat(seg.dataset.start);
        const end = parseFloat(seg.dataset.end);
        const segDur = Math.max(0.1, end - start);
        const fill = seg.querySelector('.segment-progress-fill');
        if (!fill) return;

        if (this.currentTime >= end) {
          fill.style.width = '100%';
        } else if (this.currentTime > start) {
          const segPct = ((this.currentTime - start) / segDur) * 100;
          fill.style.width = `${segPct}%`;
        } else {
          fill.style.width = '0%';
        }
      });
    }

    // Update active chapter badge
    this.updateActiveChapter();
  }

  updateActiveChapter() {
    if (!this.chapters || this.chapters.length === 0) {
      if (this.activeChapterBadge) this.activeChapterBadge.style.display = 'none';
      return;
    }

    let activeChapter = null;
    let activeIdx = -1;
    for (let i = 0; i < this.chapters.length; i++) {
      if (this.currentTime >= this.chapters[i].time) {
        activeChapter = this.chapters[i];
        activeIdx = i;
      }
    }

    if (activeChapter && this.activeChapterBadge) {
      this.activeChapterBadge.style.display = 'flex';
      const nameEl = this.activeChapterBadge.querySelector('.chapter-badge-title');
      if (nameEl) nameEl.textContent = activeChapter.title;
    }

    if (typeof this.onChapterChange === 'function' && activeIdx >= 0) {
      this.onChapterChange(activeIdx, activeChapter);
    }
  }

  buildChapterSegments() {
    if (!this.seekBarTrack) return;
    const dur = this.duration > 0 ? this.duration : 1;
    this.seekBarTrack.innerHTML = '';

    if (!this.chapters || this.chapters.length === 0) {
      // Single continuous segment
      const seg = document.createElement('div');
      seg.className = 'chapter-segment';
      seg.style.flex = '100 0 0%';
      seg.dataset.start = '0';
      seg.dataset.end = dur.toString();
      seg.innerHTML = `
        <div class="segment-hover-fill" style="width: 0%;"></div>
        <div class="segment-progress-fill" style="width: 0%;"></div>
      `;
      this.seekBarTrack.appendChild(seg);
      return;
    }

    // Sort chapters
    const sorted = [...this.chapters].sort((a, b) => a.time - b.time);
    const normalized = [];
    if (sorted[0].time > 2) {
      normalized.push({ title: 'Introduction', time: 0 });
    }
    sorted.forEach(c => normalized.push(c));

    normalized.forEach((ch, idx) => {
      const startTime = ch.time;
      const endTime = idx < normalized.length - 1 ? normalized[idx + 1].time : dur;
      const segDur = Math.max(0.1, endTime - startTime);
      const widthPct = (segDur / dur) * 100;

      const seg = document.createElement('div');
      seg.className = 'chapter-segment';
      seg.style.flex = `${widthPct} 0 0%`;
      seg.dataset.start = startTime.toString();
      seg.dataset.end = endTime.toString();
      seg.dataset.title = ch.title;
      seg.title = `${ch.title} (${this.formatTime(startTime)})`;

      seg.innerHTML = `
        <div class="segment-hover-fill" style="width: 0%;"></div>
        <div class="segment-progress-fill" style="width: 0%;"></div>
      `;
      this.seekBarTrack.appendChild(seg);
    });
  }

  // --- Controls Fade Timeout ---

  resetControlsTimeout() {
    this.showControls();
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    if (this.isPlaying) {
      this.controlsTimer = setTimeout(() => {
        if (this.isPlaying) {
          this.hideControls();
        }
      }, 2500);
    }
  }

  showControls() {
    if (this.controlsDeck) {
      this.controlsDeck.classList.remove('hidden');
      this.controlsDeck.classList.add('visible');
    }
  }

  hideControls() {
    if (this.controlsDeck) {
      this.controlsDeck.classList.remove('visible');
      this.controlsDeck.classList.add('hidden');
    }
    if (this.speedMenu) {
      this.speedMenu.classList.remove('show');
    }
  }

  triggerFlash(type) {
    if (!this.hudFlashOverlay) return;
    let iconSvg = '';
    let label = '';

    if (type === 'play') {
      iconSvg = '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    } else if (type === 'pause') {
      iconSvg = '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
    } else if (type === '+10s') {
      iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
      label = '+10s';
    } else if (type === '-10s') {
      iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
      label = '-10s';
    } else if (type === 'cc-on') {
      iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M10 10.5C9.4 9.6 8.5 9 7.5 9 6.1 9 5 10.3 5 12s1.1 3 2.5 3c1 0 1.9-.6 2.5-1.5"></path><path d="M19 10.5c-.6-.9-1.5-1.5-2.5-1.5-1.4 0-2.5 1.3-2.5 3s1.1 3 2.5 3c1 0 1.9-.6 2.5-1.5"></path></svg>';
      label = 'CC ON';
    } else if (type === 'cc-off') {
      iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M10 10.5C9.4 9.6 8.5 9 7.5 9 6.1 9 5 10.3 5 12s1.1 3 2.5 3c1 0 1.9-.6 2.5-1.5"></path><path d="M19 10.5c-.6-.9-1.5-1.5-2.5-1.5-1.4 0-2.5 1.3-2.5 3s1.1 3 2.5 3c1 0 1.9-.6 2.5-1.5"></path></svg>';
      label = 'CC OFF';
    }

    this.hudFlashOverlay.innerHTML = `
      <div class="hud-flash-circle">
        ${iconSvg}
        ${label ? `<span class="hud-flash-label">${label}</span>` : ''}
      </div>
    `;

    setTimeout(() => {
      this.hudFlashOverlay.innerHTML = '';
    }, 650);
  }

  // --- Event Binding ---

  bindEvents() {
    // Mouse move shows controls
    this.container.addEventListener('mousemove', () => this.resetControlsTimeout());
    this.container.addEventListener('mouseenter', () => this.showControls());

    // Single click: Play/Pause, Double click: Fullscreen
    if (this.clickSurface) {
      let clickTimeout = null;
      this.clickSurface.addEventListener('click', (e) => {
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
          this.toggleFullscreen();
        } else {
          clickTimeout = setTimeout(() => {
            clickTimeout = null;
            this.togglePlayPause();
          }, 220);
        }
      });
    }

    // Control buttons
    if (this.playPauseBtn) {
      this.playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlayPause();
      });
    }

    if (this.rewindBtn) {
      this.rewindBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seekRelative(-10);
      });
    }

    if (this.forwardBtn) {
      this.forwardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seekRelative(10);
      });
    }

    if (this.volumeBtn) {
      this.volumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMute();
      });
    }

    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        this.setVolume(parseFloat(e.target.value));
      });
    }

    if (this.ccBtn) {
      this.ccBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleCaptions();
      });
    }

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      });
    }

    if (this.speedBtn && this.speedMenu) {
      this.speedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.speedMenu.classList.toggle('show');
      });

      this.speedMenu.querySelectorAll('.speed-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rate = parseFloat(btn.dataset.rate);
          if (!isNaN(rate)) {
            this.setPlaybackRate(rate);
          }
        });
      });

      document.addEventListener('click', (e) => {
        if (!this.speedBtn.contains(e.target) && !this.speedMenu.contains(e.target)) {
          this.speedMenu.classList.remove('show');
        }
      });
    }

    // Hold-to-2× button (mouse & touch)
    if (this.hold2xBtn) {
      const startBoost = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startSpeedBoost();
      };
      const endBoost = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.endSpeedBoost();
      };

      this.hold2xBtn.addEventListener('mousedown', startBoost);
      this.hold2xBtn.addEventListener('mouseup', endBoost);
      this.hold2xBtn.addEventListener('mouseleave', endBoost);
      this.hold2xBtn.addEventListener('touchstart', startBoost, { passive: false });
      this.hold2xBtn.addEventListener('touchend', endBoost, { passive: false });
      this.hold2xBtn.addEventListener('touchcancel', endBoost, { passive: false });
    }

    // Restart from beginning button
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seekTo(0);
        this.play();
      });
    }

    // Seek bar interactions
    this.bindSeekBarEvents();

    // Fullscreen change
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
      this.container.classList.toggle('fullscreen', this.isFullscreen);
      if (this.fullscreenBtn) {
        this.fullscreenBtn.innerHTML = this.isFullscreen
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
        this.fullscreenBtn.title = this.isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)";
      }
    });

    // Keyboard Shortcuts
    this.bindKeyboardShortcuts();

    // Save on unload / pagehide
    window.addEventListener('beforeunload', () => this.saveProgressOnUnload());
    window.addEventListener('pagehide', () => this.saveProgressOnUnload());
  }

  bindSeekBarEvents() {
    if (!this.seekBarWrapper) return;

    const getTimeFromX = (clientX) => {
      const rect = this.seekBarWrapper.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const dur = this.duration || 1;
      return (clampedX / (rect.width || 1)) * dur;
    };

    const updateHoverUI = (clientX) => {
      const rect = this.seekBarWrapper.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const dur = this.duration || 1;
      const hoverTime = (x / (rect.width || 1)) * dur;

      if (this.seekTooltip) {
        this.seekTooltip.style.display = 'block';
        this.seekTooltip.style.left = `${x}px`;

        let chapterName = '';
        if (this.chapters && this.chapters.length > 0) {
          for (let ch of this.chapters) {
            if (hoverTime >= ch.time) chapterName = ch.title;
          }
        }

        const chEl = this.seekTooltip.querySelector('.tooltip-chapter');
        const timeEl = this.seekTooltip.querySelector('.tooltip-time');
        if (chEl) {
          chEl.textContent = chapterName;
          chEl.style.display = chapterName ? 'block' : 'none';
        }
        if (timeEl) timeEl.textContent = this.formatTime(hoverTime);
      }

      // Update hover fill inside segments
      if (this.seekBarTrack) {
        this.seekBarTrack.querySelectorAll('.chapter-segment').forEach(seg => {
          const start = parseFloat(seg.dataset.start);
          const end = parseFloat(seg.dataset.end);
          const segDur = Math.max(0.1, end - start);
          const fill = seg.querySelector('.segment-hover-fill');
          if (!fill) return;

          if (hoverTime >= end) {
            fill.style.width = '100%';
          } else if (hoverTime > start) {
            const pct = ((hoverTime - start) / segDur) * 100;
            fill.style.width = `${pct}%`;
          } else {
            fill.style.width = '0%';
          }
        });
      }
    };

    this.seekBarWrapper.addEventListener('mousemove', (e) => {
      updateHoverUI(e.clientX);
    });

    this.seekBarWrapper.addEventListener('mouseleave', () => {
      if (!this.isDraggingSeek) {
        if (this.seekTooltip) this.seekTooltip.style.display = 'none';
        if (this.seekBarTrack) {
          this.seekBarTrack.querySelectorAll('.segment-hover-fill').forEach(f => f.style.width = '0%');
        }
      }
    });

    this.seekBarWrapper.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDraggingSeek = true;
      const targetTime = getTimeFromX(e.clientX);
      this.seekTo(targetTime);
      updateHoverUI(e.clientX);
    });

    window.addEventListener('pointermove', (e) => {
      if (this.isDraggingSeek) {
        const targetTime = getTimeFromX(e.clientX);
        this.seekTo(targetTime);
        updateHoverUI(e.clientX);
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.isDraggingSeek) {
        this.isDraggingSeek = false;
        if (this.seekTooltip) this.seekTooltip.style.display = 'none';
        if (this.seekBarTrack) {
          this.seekBarTrack.querySelectorAll('.segment-hover-fill').forEach(f => f.style.width = '0%');
        }
      }
    });
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
        return;
      }

      // Spacebar
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;

        this.spacePressStart = Date.now();
        this.isHoldingSpace = false;

        setTimeout(() => {
          if (this.spacePressStart !== null && !this.isHoldingSpace) {
            this.isHoldingSpace = true;
            this.startSpeedBoost();
          }
        }, 160);
        return;
      }

      // ArrowRight (→) or L: Forward 10s
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        this.seekRelative(10);
        return;
      }

      // ArrowLeft (←) or J: Rewind 10s
      if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        this.seekRelative(-10);
        return;
      }

      // K: Play/Pause
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        this.togglePlayPause();
        return;
      }

      // C: Subtitles / Closed Captions
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.toggleCaptions();
        return;
      }

      // F: Fullscreen
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.toggleFullscreen();
        return;
      }

      // M: Mute
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.toggleMute();
        return;
      }

      // 0: Restart
      if (e.key === '0') {
        e.preventDefault();
        this.seekTo(0);
        return;
      }
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (this.isHoldingSpace) {
          this.isHoldingSpace = false;
          this.spacePressStart = null;
          this.endSpeedBoost();
        } else {
          this.spacePressStart = null;
          this.togglePlayPause();
        }
      }
    }, { passive: false });
  }

  // --- Utilities ---

  formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => n.toString().padStart(2, '0');

    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  }

  destroy() {
    this.stopProgressSaveLoop();
    this.stopLocalTicker();
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
  }
}

window.CalalogPlayer = CalalogPlayer;
