/**
 * CALALOG — Application Client Script
 * Pure Vanilla JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  initShortcutsModal();
  initUrlInput();
  initLibraryFilters();
  initCompanionTabs();
  initQueueActions();
});

// --- Keyboard Shortcuts Modal ---

function initShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  const openBtn = document.getElementById('btn-open-shortcuts');
  const closeBtn = document.getElementById('btn-close-shortcuts');

  if (!modal) return;

  const openModal = () => {
    modal.classList.add('show');
  };

  const closeModal = () => {
    modal.classList.remove('show');
  };

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeModal();
    }
    // '?' key opens shortcuts
    if (e.key === '?' && !['input', 'textarea'].includes((e.target.tagName || '').toLowerCase())) {
      openModal();
    }
  });
}

// --- URL Input Handling ---

function initUrlInput() {
  const form = document.getElementById('url-track-form');
  const input = document.getElementById('url-input-field');
  const submitBtn = document.getElementById('url-submit-btn');
  const feedback = document.getElementById('url-feedback');

  if (!form || !input) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <span class="pulse-dot" style="display:inline-block; margin-right: 4px;"></span>
        <span>Tracking...</span>
      `;
    }

    if (feedback) {
      feedback.style.display = 'none';
      feedback.className = 'feedback-banner';
    }

    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add video');
      }

      if (feedback) {
        feedback.style.display = 'flex';
        feedback.className = 'feedback-banner success';
        feedback.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span>"${data.video.title}" tracked successfully! Loading player...</span>
        `;
      }

      // Redirect or load into player
      setTimeout(() => {
        window.location.href = `/?v=${data.video.id}`;
      }, 700);

    } catch (err) {
      if (feedback) {
        feedback.style.display = 'flex';
        feedback.className = 'feedback-banner error';
        feedback.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>${err.message}</span>
        `;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Track</span>
        `;
      }
    }
  });
}

// --- Library Search, Filter & Sort ---

function initLibraryFilters() {
  const searchInput = document.getElementById('library-search-input');
  const sortSelect = document.getElementById('library-sort-select');
  const filterTabs = document.querySelectorAll('.filter-tab-btn');
  const videoCards = document.querySelectorAll('.video-card');
  const noMatchMsg = document.getElementById('library-no-match');

  if (!videoCards.length) return;

  let currentFilter = 'all';
  let searchQuery = '';

  const filterAndSortCards = () => {
    const container = document.getElementById('library-cards-container');
    if (!container) return;

    const cardsArray = Array.from(videoCards);
    let visibleCount = 0;

    cardsArray.forEach(card => {
      const status = card.dataset.status;
      const title = (card.dataset.title || '').toLowerCase();
      const videoId = (card.dataset.youtubeId || '').toLowerCase();

      // Filter by status
      const matchesStatus = (currentFilter === 'all' || status === currentFilter);

      // Filter by search query
      const matchesSearch = !searchQuery || title.includes(searchQuery) || videoId.includes(searchQuery);

      if (matchesStatus && matchesSearch) {
        card.style.display = 'flex';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (noMatchMsg) {
      noMatchMsg.style.display = visibleCount === 0 ? 'block' : 'none';
    }

    // Sort visible cards
    const sortBy = sortSelect ? sortSelect.value : 'recent_watched';
    cardsArray.sort((a, b) => {
      if (sortBy === 'recent_watched') {
        const aTime = a.dataset.lastWatched ? new Date(a.dataset.lastWatched).getTime() : 0;
        const bTime = b.dataset.lastWatched ? new Date(b.dataset.lastWatched).getTime() : 0;
        return bTime - aTime;
      }
      if (sortBy === 'recent_added') {
        const aTime = a.dataset.createdAt ? new Date(a.dataset.createdAt).getTime() : 0;
        const bTime = b.dataset.createdAt ? new Date(b.dataset.createdAt).getTime() : 0;
        return bTime - aTime;
      }
      if (sortBy === 'progress') {
        const aPct = parseFloat(a.dataset.progress || 0);
        const bPct = parseFloat(b.dataset.progress || 0);
        return bPct - aPct;
      }
      if (sortBy === 'title') {
        return (a.dataset.title || '').localeCompare(b.dataset.title || '');
      }
      return 0;
    });

    cardsArray.forEach(card => container.appendChild(card));
  };

  // Bind filter tabs
  filterTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      filterTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      filterAndSortCards();
    });
  });

  // Bind search input
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      filterAndSortCards();
    });
  }

  // Bind sort select
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      filterAndSortCards();
    });
  }
}

// --- Companion Tabs (Chapters vs Queue) ---

function initCompanionTabs() {
  const tabChaptersBtn = document.getElementById('tab-btn-chapters');
  const tabQueueBtn = document.getElementById('tab-btn-queue');
  const chaptersView = document.getElementById('companion-chapters-view');
  const queueView = document.getElementById('companion-queue-view');

  if (!tabChaptersBtn || !tabQueueBtn || !chaptersView || !queueView) return;

  tabChaptersBtn.addEventListener('click', () => {
    tabChaptersBtn.classList.add('active');
    tabQueueBtn.classList.remove('active');
    chaptersView.style.display = 'block';
    queueView.style.display = 'none';
  });

  tabQueueBtn.addEventListener('click', () => {
    tabQueueBtn.classList.add('active');
    tabChaptersBtn.classList.remove('active');
    queueView.style.display = 'block';
    chaptersView.style.display = 'none';
  });
}

// --- Queue & Video Actions ---

function initQueueActions() {
  // Global event delegation for queue & video actions
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const videoId = target.dataset.videoId;
    const queueId = target.dataset.queueId;

    // Add to Queue
    if (action === 'add-to-queue' && videoId) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId })
        });
        if (res.ok) {
          target.innerHTML = '✓ Queued';
          target.disabled = true;
          setTimeout(() => {
            window.location.reload();
          }, 400);
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Delete Video from Library
    if (action === 'delete-video' && videoId) {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm('Are you sure you want to remove this video from your library?')) return;

      try {
        const res = await fetch(`/api/library/${videoId}`, { method: 'DELETE' });
        if (res.ok) {
          const card = document.getElementById(`video-card-${videoId}`);
          if (card) card.remove();
          // If we deleted the active video, reload to show next
          if (window.location.search.includes(videoId)) {
            window.location.href = '/';
          }
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Mark Completed
    if (action === 'mark-completed' && videoId) {
      e.preventDefault();
      e.stopPropagation();
      const dur = parseInt(target.dataset.duration || '0');
      try {
        const res = await fetch(`/api/library/${videoId}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentTime: dur,
            duration: dur,
            progressPercentage: 100,
            status: 'completed'
          })
        });
        if (res.ok) {
          window.location.reload();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Mark Unwatched / Reset Progress
    if (action === 'reset-progress' && videoId) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const res = await fetch(`/api/library/${videoId}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentTime: 0,
            progressPercentage: 0,
            status: 'unwatched'
          })
        });
        if (res.ok) {
          window.location.reload();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Remove from Queue
    if (action === 'remove-queue-item' && queueId) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const res = await fetch(`/api/queue/${queueId}`, { method: 'DELETE' });
        if (res.ok) {
          window.location.reload();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Clear entire Queue
    if (action === 'clear-queue') {
      e.preventDefault();
      if (!confirm('Clear all videos from your queue?')) return;
      try {
        const res = await fetch('/api/queue', { method: 'DELETE' });
        if (res.ok) {
          window.location.reload();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Move Queue Item Up / Down
    if ((action === 'move-queue-up' || action === 'move-queue-down') && queueId) {
      e.preventDefault();
      e.stopPropagation();
      const queueList = Array.from(document.querySelectorAll('.queue-item'));
      const currentIndex = queueList.findIndex(el => el.dataset.queueId === queueId);
      if (currentIndex === -1) return;

      const targetIndex = action === 'move-queue-up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= queueList.length) return;

      const ids = queueList.map(el => el.dataset.queueId);
      const [moved] = ids.splice(currentIndex, 1);
      ids.splice(targetIndex, 0, moved);

      try {
        const res = await fetch('/api/queue/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds: ids })
        });
        if (res.ok) {
          window.location.reload();
        }
      } catch (err) {
        console.error(err);
      }
    }
  });
}
