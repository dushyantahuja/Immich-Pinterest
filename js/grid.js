/**
 * Masonry & Infinite Grid Controller with Layout Stability & Smooth Preloading
 * Uses multi-column flex containers to ensure items are appended strictly to
 * the bottom of the shortest column, preventing items jumping to the top of the feed.
 */

import { getThumbnailUrl, getImmichWebUrl } from './api.js';

export class GalleryGrid {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.onRequestAppend = options.onRequestAppend || (() => {});
    this.onItemClick = options.onItemClick || (() => {});
    this.onFavoriteClick = options.onFavoriteClick || (() => {});

    this.items = [];
    this.cardElements = [];
    this.columns = [];
    this.columnHeights = [];
    this.columnCount = 0;
    this.observer = null;
    this.isLoading = false;

    this.init();
  }

  init() {
    this.container.classList.add('masonry-grid');
    this.setupScrollObserver();
    this.setupResizeListener();
  }

  /**
   * Determine column count based on viewport width matching media queries
   */
  getColumnCount() {
    const width = window.innerWidth;
    if (width <= 600) return 2;
    if (width <= 960) return 3;
    if (width <= 1400) return 4;
    if (width <= 1900) return 5;
    return 6;
  }

  /**
   * Initialise column wrapper elements
   */
  setupColumns(columnCount = null) {
    this.columnCount = columnCount || this.getColumnCount();
    this.container.innerHTML = '';
    this.columns = [];
    this.columnHeights = [];

    for (let i = 0; i < this.columnCount; i++) {
      const col = document.createElement('div');
      col.className = 'masonry-column';
      this.container.appendChild(col);
      this.columns.push(col);
      this.columnHeights.push(0);
    }
  }

  /**
   * Listen for window resize to reorganise columns when breakpoint changes
   */
  setupResizeListener() {
    let resizeTimeout = null;
    window.addEventListener('resize', () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!this.items.length) return;
        const newCount = this.getColumnCount();
        if (newCount !== this.columnCount) {
          this.rebuildGrid(newCount);
        }
      }, 150);
    }, { passive: true });
  }

  /**
   * Reorganise existing cards across new number of columns preserving order
   */
  rebuildGrid(newCount) {
    if (!this.items.length || !this.cardElements.length) {
      this.setupColumns(newCount);
      return;
    }

    const cards = [...this.cardElements];
    const items = [...this.items];

    this.setupColumns(newCount);
    const colWidth = this.columns[0]?.offsetWidth || 300;
    const colFragments = this.columns.map(() => document.createDocumentFragment());

    cards.forEach((card, idx) => {
      const asset = items[idx];

      let minColIndex = 0;
      let minHeight = this.columnHeights[0];
      for (let i = 1; i < this.columnHeights.length; i++) {
        if (this.columnHeights[i] < minHeight) {
          minHeight = this.columnHeights[i];
          minColIndex = i;
        }
      }

      colFragments[minColIndex].appendChild(card);

      const ar = asset?.aspectRatio || 0.75;
      const hasSubtitle = Boolean(asset?.location || asset?.camera || asset?.dateTaken);
      const estimatedCardHeight = (colWidth / ar) + (hasSubtitle ? 60 : 42) + 16;
      this.columnHeights[minColIndex] += estimatedCardHeight;
    });

    for (let i = 0; i < this.columns.length; i++) {
      if (colFragments[i].hasChildNodes()) {
        this.columns[i].appendChild(colFragments[i]);
      }
    }

    requestAnimationFrame(() => {
      if (this.columns) {
        for (let i = 0; i < this.columns.length; i++) {
          this.columnHeights[i] = this.columns[i].offsetHeight || this.columnHeights[i];
        }
      }
    });
  }

  /**
   * Hardware-accelerated intersection observer for smooth, jump-free preloading
   */
  setupScrollObserver() {
    const sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) return;

    if (this.observer) {
      this.observer.disconnect();
    }

    // Preload when sentinel is within 800px of the viewport
    this.observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !this.isLoading && this.items.length > 0) {
        this.onRequestAppend();
      }
    }, {
      rootMargin: '800px 0px 800px 0px',
      threshold: 0
    });

    this.observer.observe(sentinel);
  }

  setLoading(loading) {
    this.isLoading = loading;
    const loader = document.getElementById('loading-spinner');
    if (loader) {
      loader.classList.toggle('visible', loading);
    }

    // When loading finishes, re-evaluate sentinel intersection state
    if (!loading && this.observer) {
      const sentinel = document.getElementById('scroll-sentinel');
      if (sentinel) {
        this.observer.unobserve(sentinel);
        this.observer.observe(sentinel);
      }
    }
  }

  clear() {
    this.items = [];
    this.cardElements = [];
    this.container.innerHTML = '';
    this.columns = [];
    this.columnHeights = [];
  }

  /**
   * Append new assets strictly to the bottom of the shortest column
   * Batches DOM insertions using DocumentFragments to avoid layout thrashing
   */
  appendAssets(assets) {
    if (!assets || assets.length === 0) return;

    const validAssets = assets.filter(a => a && a.id);
    if (validAssets.length === 0) return;

    if (!this.columns || this.columns.length === 0) {
      this.setupColumns();
    }

    const startIndex = this.items.length;
    this.items.push(...validAssets);

    // Synchronise actual column heights before placing new batch
    for (let i = 0; i < this.columns.length; i++) {
      this.columnHeights[i] = this.columns[i].offsetHeight || 0;
    }

    const colWidth = this.columns[0]?.offsetWidth || 300;
    const colFragments = this.columns.map(() => document.createDocumentFragment());

    validAssets.forEach((asset, idx) => {
      const card = this.createCardElement(asset, startIndex + idx);
      this.cardElements.push(card);

      // Identify column with minimum height
      let minColIndex = 0;
      let minHeight = this.columnHeights[0];
      for (let i = 1; i < this.columnHeights.length; i++) {
        if (this.columnHeights[i] < minHeight) {
          minHeight = this.columnHeights[i];
          minColIndex = i;
        }
      }

      colFragments[minColIndex].appendChild(card);

      // Estimate card height based on aspect ratio and presence of subtitle
      const ar = asset.aspectRatio || 0.75;
      const hasSubtitle = Boolean(asset.location || asset.camera || asset.dateTaken);
      const estimatedCardHeight = (colWidth / ar) + (hasSubtitle ? 60 : 42) + 16;
      this.columnHeights[minColIndex] += estimatedCardHeight;
    });

    // Single batch append per column
    for (let i = 0; i < this.columns.length; i++) {
      if (colFragments[i].hasChildNodes()) {
        this.columns[i].appendChild(colFragments[i]);
      }
    }

    // Re-synchronise actual heights after DOM render
    requestAnimationFrame(() => {
      if (this.columns) {
        for (let i = 0; i < this.columns.length; i++) {
          this.columnHeights[i] = this.columns[i].offsetHeight || this.columnHeights[i];
        }
      }
    });
  }

  createCardElement(asset, index) {
    const card = document.createElement('div');
    card.className = 'pin-card';
    card.dataset.id = asset.id;
    card.dataset.index = index;

    const ar = asset.aspectRatio || 0.75;
    const thumbUrl = getThumbnailUrl(asset, 'preview');
    const immichWebUrl = getImmichWebUrl(asset);

    // Subtitle label
    let subtitle = '';
    if (asset.location) {
      subtitle = `<span class="pin-meta-location"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(asset.location)}</span>`;
    } else if (asset.camera) {
      subtitle = `<span class="pin-meta-camera"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>${escapeHtml(asset.camera)}</span>`;
    } else if (asset.dateTaken) {
      const formatted = new Date(asset.dateTaken).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      subtitle = `<span class="pin-meta-date">${formatted}</span>`;
    }

    card.innerHTML = `
      <div class="pin-media-wrapper" style="--aspect-ratio: ${ar};">
        <div class="pin-skeleton"></div>
        <img 
          class="pin-img" 
          src="${thumbUrl}" 
          alt="${escapeHtml(asset.originalFileName)}" 
          loading="lazy"
          decoding="async"
        />
        <div class="pin-overlay">
          <div class="pin-overlay-top">
            <a href="${immichWebUrl}" target="_blank" rel="noopener noreferrer" class="pin-action-btn pin-immich-btn" title="Open in Immich" onclick="event.stopPropagation();">
              <span>Immich</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <button class="pin-action-btn pin-fav-btn ${asset.isFavorite ? 'active' : ''}" title="${asset.isFavorite ? 'Favorited' : 'Favorite'}" onclick="event.stopPropagation();">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${asset.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
          </div>
          <div class="pin-overlay-bottom">
            <button class="pin-action-btn pin-view-btn" title="View Full Details">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
              <span>View</span>
            </button>
          </div>
        </div>
      </div>
      <div class="pin-info">
        <div class="pin-title">${escapeHtml(asset.description || asset.originalFileName)}</div>
        ${subtitle ? `<div class="pin-subtitle">${subtitle}</div>` : ''}
      </div>
    `;

    const img = card.querySelector('.pin-img');

    // Handle immediate cached load vs async load
    if (img.complete && img.naturalWidth > 0) {
      card.classList.add('loaded');
    } else {
      img.addEventListener('load', () => {
        card.classList.add('loaded');
      }, { once: true });
    }

    img.addEventListener('error', () => {
      card.classList.add('load-error');
      const mediaWrapper = card.querySelector('.pin-media-wrapper');
      if (mediaWrapper) {
        mediaWrapper.innerHTML = `
          <div class="pin-error-placeholder">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Photo unavailable</span>
          </div>
        `;
      }
    }, { once: true });

    // Card click opens modal
    card.addEventListener('click', () => {
      this.onItemClick(asset, parseInt(card.dataset.index, 10));
    });

    const favBtn = card.querySelector('.pin-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        asset.isFavorite = !asset.isFavorite;
        favBtn.classList.toggle('active', asset.isFavorite);
        favBtn.querySelector('svg').setAttribute('fill', asset.isFavorite ? 'currentColor' : 'none');
        this.onFavoriteClick(asset);
      });
    }

    return card;
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
