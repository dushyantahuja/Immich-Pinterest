/**
 * Main Application Controller for Immich Pinterest
 */

import { 
  getSettings, 
  saveSettings, 
  fetchRandomAssets, 
  testConnection, 
  getThumbnailUrl, 
  getOriginalUrl, 
  getImmichWebUrl 
} from './api.js';
import { GalleryGrid } from './grid.js';

class App {
  constructor() {
    this.assets = [];
    this.currentIndex = -1;
    this.isSlideshowActive = false;
    this.slideshowTimer = null;
    this.grid = null;
    this.isLoadingMore = false;

    this.init();
  }

  async init() {
    this.applyTheme(getSettings().theme);
    this.bindDOM();
    this.setupGrid();
    this.populateSettingsForm();
    this.updateHeaderBadge();
    this.bindKeyboardShortcuts();

    const settings = getSettings();
    if (!settings.apiKey && !settings.demoMode) {
      this.showSetupBanner(true);
    }

    // Load initial photos
    await this.loadMorePhotos(true);
  }

  bindDOM() {
    // Buttons
    this.btnShuffle = document.getElementById('btn-shuffle');
    this.btnFilterFav = document.getElementById('btn-filter-fav');
    this.btnSlideshow = document.getElementById('btn-slideshow');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnTheme = document.getElementById('btn-theme');

    // Modals
    this.modalDetail = document.getElementById('modal-detail');
    this.modalSettings = document.getElementById('modal-settings');
    this.slideshowContainer = document.getElementById('slideshow-container');
    this.setupBanner = document.getElementById('setup-banner');

    // Events
    this.btnShuffle.addEventListener('click', () => this.shuffleGallery());
    this.btnFilterFav.addEventListener('click', () => this.toggleFavoriteFilter());
    this.btnSlideshow.addEventListener('click', () => this.startSlideshow());
    this.btnSettings.addEventListener('click', () => this.openSettingsModal());
    this.btnTheme.addEventListener('click', () => this.cycleTheme());

    // Modal Close
    document.querySelectorAll('.modal-close-btn, .modal-backdrop').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('.modal-close-btn')) {
          this.closeAllModals();
        }
      });
    });

    // Detail Modal Navigation
    document.getElementById('modal-prev-btn').addEventListener('click', () => this.navigateModal(-1));
    document.getElementById('modal-next-btn').addEventListener('click', () => this.navigateModal(1));

    // Settings Form
    document.getElementById('form-settings').addEventListener('submit', (e) => this.handleSettingsSubmit(e));
    document.getElementById('btn-test-connection').addEventListener('click', () => this.handleTestConnection());
    document.getElementById('btn-toggle-apikey-visibility').addEventListener('click', () => this.toggleApiKeyVisibility());

    // Setup Banner buttons
    document.getElementById('banner-open-settings')?.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('banner-enable-demo')?.addEventListener('click', () => {
      saveSettings({ demoMode: true });
      this.showSetupBanner(false);
      this.populateSettingsForm();
      this.shuffleGallery();
    });

    // Slideshow HUD
    document.getElementById('slideshow-exit-btn')?.addEventListener('click', () => this.stopSlideshow());
    document.getElementById('slideshow-prev-btn')?.addEventListener('click', () => this.slideshowStep(-1));
    document.getElementById('slideshow-next-btn')?.addEventListener('click', () => this.slideshowStep(1));
    document.getElementById('slideshow-pause-btn')?.addEventListener('click', () => this.toggleSlideshowPause());
  }

  setupGrid() {
    const container = document.getElementById('gallery-container');
    this.grid = new GalleryGrid(container, {
      onRequestAppend: () => this.loadMorePhotos(false),
      onItemClick: (asset, index) => this.openDetailModal(index),
      onFavoriteClick: (asset) => this.handleFavoriteToggled(asset)
    });
  }

  async loadMorePhotos(isInitial = false) {
    if (this.isLoadingMore) return;
    this.isLoadingMore = true;
    this.grid.setLoading(true);

    const settings = getSettings();
    const batchSize = settings.batchSize || 30;

    try {
      const newAssets = await fetchRandomAssets(batchSize, settings.isFavoriteOnly);
      if (newAssets && newAssets.length > 0) {
        this.assets.push(...newAssets);
        this.grid.appendAssets(newAssets);
        this.showSetupBanner(false);

        // Remove any prior error state
        const existingError = document.getElementById('gallery-empty-state');
        if (existingError) existingError.remove();
      } else if (isInitial) {
        this.showEmptyState('No photos found in your Immich library matching the criteria.');
      }
    } catch (err) {
      console.error('Error fetching photos:', err);
      if (err.message === 'API_KEY_REQUIRED' || err.message?.includes('401') || err.message?.includes('403')) {
        this.showSetupBanner(true, 'Authentication required: please enter your Immich API Key in Settings.');
      } else if (isInitial && this.assets.length === 0) {
        this.showErrorState(`Unable to load photos from Immich (${err.message || 'Connection error'}).`);
      }
    } finally {
      this.isLoadingMore = false;
      this.grid.setLoading(false);
    }
  }

  async shuffleGallery() {
    this.btnShuffle.classList.add('spinning');
    this.assets = [];
    this.grid.clear();
    const emptyState = document.getElementById('gallery-empty-state');
    if (emptyState) emptyState.remove();

    await this.loadMorePhotos(true);
    setTimeout(() => {
      this.btnShuffle.classList.remove('spinning');
    }, 500);
  }

  toggleFavoriteFilter() {
    const settings = getSettings();
    const isFav = !settings.isFavoriteOnly;
    saveSettings({ isFavoriteOnly: isFav });
    this.btnFilterFav.classList.toggle('active', isFav);
    this.shuffleGallery();
  }

  /* ---------------- Modal & Detail Viewer ---------------- */

  openDetailModal(index) {
    if (index < 0 || index >= this.assets.length) return;
    this.currentIndex = index;
    const asset = this.assets[index];

    const img = document.getElementById('modal-img');
    const title = document.getElementById('modal-title');
    const date = document.getElementById('modal-date');
    const camera = document.getElementById('modal-camera');
    const lens = document.getElementById('modal-lens');
    const exposure = document.getElementById('modal-exposure');
    const location = document.getElementById('modal-location');
    const immichLink = document.getElementById('modal-immich-link');
    const downloadLink = document.getElementById('modal-download-link');
    const copyLinkBtn = document.getElementById('modal-copy-link-btn');
    const modalFavBtn = document.getElementById('modal-fav-btn');

    // Populate data
    title.textContent = asset.description || asset.originalFileName;
    
    if (asset.dateTaken) {
      const dt = new Date(asset.dateTaken);
      date.textContent = dt.toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      date.parentElement.style.display = 'flex';
    } else {
      date.parentElement.style.display = 'none';
    }

    if (asset.camera) {
      camera.textContent = asset.camera;
      camera.parentElement.style.display = 'flex';
    } else {
      camera.parentElement.style.display = 'none';
    }

    if (asset.lens) {
      lens.textContent = asset.lens;
      lens.parentElement.style.display = 'flex';
    } else {
      lens.parentElement.style.display = 'none';
    }

    if (asset.exposure) {
      exposure.textContent = asset.exposure;
      exposure.parentElement.style.display = 'flex';
    } else {
      exposure.parentElement.style.display = 'none';
    }

    if (asset.location) {
      location.textContent = asset.location;
      location.parentElement.style.display = 'flex';
    } else {
      location.parentElement.style.display = 'none';
    }

    // Links & Actions
    immichLink.href = getImmichWebUrl(asset);
    downloadLink.href = getOriginalUrl(asset);
    downloadLink.setAttribute('download', asset.originalFileName || 'immich_photo.jpg');

    copyLinkBtn.onclick = () => {
      navigator.clipboard.writeText(getImmichWebUrl(asset)).then(() => {
        copyLinkBtn.classList.add('copied');
        setTimeout(() => copyLinkBtn.classList.remove('copied'), 2000);
      });
    };

    // Favorite button
    modalFavBtn.classList.toggle('active', asset.isFavorite);
    modalFavBtn.onclick = () => {
      asset.isFavorite = !asset.isFavorite;
      modalFavBtn.classList.toggle('active', asset.isFavorite);
      const card = document.querySelector(`.pin-card[data-id="${asset.id}"]`);
      if (card) {
        const fav = card.querySelector('.pin-fav-btn');
        if (fav) fav.classList.toggle('active', asset.isFavorite);
      }
    };

    // Image loading
    img.src = '';
    img.classList.add('loading');
    const highResUrl = getThumbnailUrl(asset, 'preview');
    img.src = highResUrl;
    img.onload = () => img.classList.remove('loading');

    this.modalDetail.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  navigateModal(direction) {
    const newIndex = this.currentIndex + direction;
    if (newIndex >= 0 && newIndex < this.assets.length) {
      this.openDetailModal(newIndex);
    } else if (newIndex >= this.assets.length) {
      this.loadMorePhotos().then(() => {
        if (newIndex < this.assets.length) {
          this.openDetailModal(newIndex);
        }
      });
    }
  }

  closeAllModals() {
    this.modalDetail.classList.remove('active');
    this.modalSettings.classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ---------------- Slideshow Mode ---------------- */

  startSlideshow() {
    if (this.assets.length === 0) return;
    this.isSlideshowActive = true;
    this.slideshowContainer.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (this.currentIndex < 0) this.currentIndex = 0;
    this.renderSlideshowSlide();
    this.scheduleNextSlide();
  }

  stopSlideshow() {
    this.isSlideshowActive = false;
    clearTimeout(this.slideshowTimer);
    this.slideshowContainer.classList.remove('active');
    document.body.style.overflow = '';
  }

  toggleSlideshowPause() {
    const btn = document.getElementById('slideshow-pause-btn');
    if (this.slideshowTimer) {
      clearTimeout(this.slideshowTimer);
      this.slideshowTimer = null;
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      btn.title = 'Play Slideshow';
    } else {
      this.scheduleNextSlide();
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      btn.title = 'Pause Slideshow';
    }
  }

  slideshowStep(direction) {
    clearTimeout(this.slideshowTimer);
    this.currentIndex = (this.currentIndex + direction + this.assets.length) % this.assets.length;
    this.renderSlideshowSlide();
    if (this.isSlideshowActive) {
      this.scheduleNextSlide();
    }
  }

  renderSlideshowSlide() {
    const asset = this.assets[this.currentIndex];
    if (!asset) return;

    const img = document.getElementById('slideshow-img');
    const title = document.getElementById('slideshow-title');
    const meta = document.getElementById('slideshow-meta');

    img.classList.remove('fade-in');
    void img.offsetWidth;
    img.src = getThumbnailUrl(asset, 'preview');
    img.classList.add('fade-in');

    title.textContent = asset.description || asset.originalFileName;
    meta.textContent = [asset.location, asset.camera, asset.dateTaken ? new Date(asset.dateTaken).getFullYear() : null].filter(Boolean).join(' • ');
  }

  scheduleNextSlide() {
    clearTimeout(this.slideshowTimer);
    const settings = getSettings();
    const intervalMs = (settings.slideshowInterval || 5) * 1000;

    const bar = document.getElementById('slideshow-progress-bar');
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '0%';
      setTimeout(() => {
        bar.style.transition = `width ${intervalMs}ms linear`;
        bar.style.width = '100%';
      }, 50);
    }

    this.slideshowTimer = setTimeout(() => {
      if (this.isSlideshowActive) {
        this.slideshowStep(1);
      }
    }, intervalMs);
  }

  /* ---------------- Settings & Configuration ---------------- */

  openSettingsModal() {
    this.populateSettingsForm();
    this.modalSettings.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  populateSettingsForm() {
    const settings = getSettings();
    document.getElementById('input-server-url').value = settings.serverUrl;
    document.getElementById('input-api-key').value = settings.apiKey;
    document.getElementById('select-batch-size').value = settings.batchSize;
    document.getElementById('input-slideshow-interval').value = settings.slideshowInterval;
    document.getElementById('select-theme').value = settings.theme;
    document.getElementById('check-demo-mode').checked = settings.demoMode;
    document.getElementById('connection-status-msg').textContent = '';
    document.getElementById('connection-status-msg').className = 'status-message';
  }

  handleSettingsSubmit(e) {
    e.preventDefault();
    const serverUrl = document.getElementById('input-server-url').value.trim();
    const apiKey = document.getElementById('input-api-key').value.trim();
    const batchSize = parseInt(document.getElementById('select-batch-size').value, 10);
    const slideshowInterval = parseInt(document.getElementById('input-slideshow-interval').value, 10);
    const theme = document.getElementById('select-theme').value;
    const demoMode = document.getElementById('check-demo-mode').checked;

    saveSettings({
      serverUrl,
      apiKey,
      batchSize,
      slideshowInterval,
      theme,
      demoMode
    });

    this.applyTheme(theme);
    this.updateHeaderBadge();
    this.closeAllModals();
    this.shuffleGallery();
  }

  updateHeaderBadge() {
    const badge = document.getElementById('header-server-badge');
    if (!badge) return;
    const settings = getSettings();
    if (settings.demoMode) {
      badge.textContent = 'Demo Mode';
      return;
    }
    const serverUrl = settings.serverUrl || 'http://localhost:2283';
    try {
      const url = new URL(serverUrl);
      badge.textContent = url.host || serverUrl;
    } catch {
      badge.textContent = serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'Immich';
    }
  }

  async handleTestConnection() {
    const serverUrl = document.getElementById('input-server-url').value.trim();
    const apiKey = document.getElementById('input-api-key').value.trim();
    const statusMsg = document.getElementById('connection-status-msg');
    const testBtn = document.getElementById('btn-test-connection');

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    statusMsg.className = 'status-message info';
    statusMsg.textContent = 'Connecting to Immich...';

    const res = await testConnection(serverUrl, apiKey);

    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';

    if (res.success) {
      statusMsg.className = 'status-message success';
      statusMsg.textContent = `✓ ${res.message}`;
    } else {
      statusMsg.className = 'status-message error';
      statusMsg.textContent = `✕ ${res.message}`;
    }
  }

  toggleApiKeyVisibility() {
    const input = document.getElementById('input-api-key');
    const btn = document.getElementById('btn-toggle-apikey-visibility');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'Hide';
    } else {
      input.type = 'password';
      btn.textContent = 'Show';
    }
  }

  showSetupBanner(show, customMessage = null) {
    if (!this.setupBanner) return;
    if (customMessage) {
      const msgEl = this.setupBanner.querySelector('.banner-text');
      if (msgEl) msgEl.textContent = customMessage;
    }
    this.setupBanner.classList.toggle('visible', show);
  }

  showEmptyState(message) {
    const existing = document.getElementById('gallery-empty-state');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'gallery-empty-state';
    div.className = 'gallery-empty-state';
    div.innerHTML = `
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </div>
      <h3>No Photos Found</h3>
      <p>${escapeHtml(message)}</p>
      <div class="empty-actions">
        <button class="btn btn-primary" onclick="app.shuffleGallery()">Shuffle Again</button>
      </div>
    `;
    document.getElementById('gallery-container').appendChild(div);
  }

  showErrorState(message) {
    const existing = document.getElementById('gallery-empty-state');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'gallery-empty-state';
    div.className = 'gallery-empty-state error';
    div.innerHTML = `
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <h3>Could Not Load Immich Photos</h3>
      <p>${escapeHtml(message)}</p>
      <div class="empty-actions">
        <button class="btn btn-primary" onclick="app.shuffleGallery()">Retry</button>
        <button class="btn btn-secondary" onclick="app.openSettingsModal()">Open Settings</button>
      </div>
    `;
    document.getElementById('gallery-container').appendChild(div);
  }

  enableDemoMode() {
    saveSettings({ demoMode: true });
    this.populateSettingsForm();
    this.updateHeaderBadge();
    this.shuffleGallery();
  }

  /* ---------------- Themes & Shortcuts ---------------- */

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  cycleTheme() {
    const settings = getSettings();
    const themes = ['system', 'light', 'dark'];
    const nextTheme = themes[(themes.indexOf(settings.theme) + 1) % themes.length];
    saveSettings({ theme: nextTheme });
    this.applyTheme(nextTheme);
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (this.isSlideshowActive) {
        if (e.key === 'Escape') this.stopSlideshow();
        if (e.key === 'ArrowRight' || e.key === ' ') this.slideshowStep(1);
        if (e.key === 'ArrowLeft') this.slideshowStep(-1);
        return;
      }

      if (this.modalDetail.classList.contains('active')) {
        if (e.key === 'Escape') this.closeAllModals();
        if (e.key === 'ArrowRight') this.navigateModal(1);
        if (e.key === 'ArrowLeft') this.navigateModal(-1);
        return;
      }

      if (this.modalSettings.classList.contains('active')) {
        if (e.key === 'Escape') this.closeAllModals();
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        this.shuffleGallery();
      } else if (e.key === 's' || e.key === 'S') {
        this.startSlideshow();
      }
    });
  }

  handleFavoriteToggled(asset) {
    // Optional callback for favorites
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.app = new App();
