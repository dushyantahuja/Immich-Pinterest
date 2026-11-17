/**
 * Immich API Client & Settings Management
 */

const STORAGE_KEY = 'immich_pinterest_settings';
const FAVORITES_STORAGE_KEY = 'immich_pinterest_local_favorites';

export const defaultSettings = {
  serverUrl: 'http://localhost:2283',
  apiKey: '',
  batchSize: 30,
  isFavoriteOnly: false,
  quality: 'preview', // 'preview' or 'thumbnail'
  slideshowInterval: 5, // in seconds
  theme: 'system', // 'system', 'light', 'dark'
  demoMode: false
};

export function getSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...defaultSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Error reading settings from localStorage:', e);
  }
  return { ...defaultSettings };
}

export function saveSettings(newSettings) {
  try {
    const current = getSettings();
    const merged = { ...current, ...newSettings };
    if (merged.serverUrl) {
      merged.serverUrl = merged.serverUrl.replace(/\/+$/, '');
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (e) {
    console.error('Error saving settings to localStorage:', e);
    return newSettings;
  }
}

/**
 * Determine the best API base URL to avoid CORS:
 * - If running on any HTTP server (Docker, Traefik, server.py, etc.), uses relative /api proxy (same-origin)
 * - Otherwise uses configured serverUrl
 */
export function getApiBaseUrl() {
  if (window.location.protocol.startsWith('http')) {
    return '';
  }
  const settings = getSettings();
  return settings.serverUrl.replace(/\/+$/, '');
}

/**
 * Format asset thumbnail URL with authentication
 */
export function getThumbnailUrl(asset, size = 'thumbnail') {
  if (!asset) return '';
  if (asset.isDemo) return asset.demoUrl || asset.thumbnailUrl;

  const settings = getSettings();
  const apiKey = settings.apiKey ? `&apiKey=${encodeURIComponent(settings.apiKey)}` : '';
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}/api/assets/${asset.id}/thumbnail?size=${size}${apiKey}`;
}

/**
 * Format full-size original asset URL
 */
export function getOriginalUrl(asset) {
  if (!asset) return '';
  if (asset.isDemo) return asset.demoOriginalUrl || asset.demoUrl || asset.thumbnailUrl;

  const settings = getSettings();
  const apiKey = settings.apiKey ? `?apiKey=${encodeURIComponent(settings.apiKey)}` : '';
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}/api/assets/${asset.id}/original${apiKey}`;
}

/**
 * Format deep link to Immich Web UI photo page
 */
export function getImmichWebUrl(asset) {
  if (!asset) return '';
  const settings = getSettings();
  const baseUrl = settings.serverUrl.replace(/\/+$/, '');
  if (asset.isDemo) return `${baseUrl}/photos`;
  return `${baseUrl}/photos/${asset.id}`;
}

/**
 * Get locally saved favourite asset IDs
 */
export function getLocalFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Persist favourite asset ID to localStorage
 */
export function saveLocalFavorite(assetId, isFavorite) {
  try {
    const favorites = getLocalFavorites();
    if (isFavorite) {
      favorites.add(assetId);
    } else {
      favorites.delete(assetId);
    }
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favorites)));
  } catch (e) {
    console.warn('Failed to save favourite to localStorage', e);
  }
}

/**
 * Update asset favourite status in Immich upstream API
 */
export async function updateImmichAssetFavorite(assetId, isFavorite) {
  const settings = getSettings();
  if (settings.demoMode || !assetId) {
    return { success: true, localOnly: true };
  }

  const baseUrl = getApiBaseUrl();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (settings.apiKey) {
    headers['x-api-key'] = settings.apiKey;
  }

  try {
    const url = `${baseUrl}/api/assets/${assetId}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ isFavorite })
    });

    if (response.ok) {
      return { success: true };
    }

    const data = await response.json().catch(() => ({}));
    const message = data.message || `HTTP ${response.status}`;
    return { success: false, error: message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Test connectivity with Immich server and API key
 */
export async function testConnection(serverUrl, apiKey) {
  const cleanUrl = (serverUrl || '').replace(/\/+$/, '');

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  // Try via local proxy first if on localhost, else direct
  const candidateUrls = [];
  if (window.location.protocol.startsWith('http') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    candidateUrls.push('/api/search/random');
  }
  if (cleanUrl) {
    candidateUrls.push(`${cleanUrl}/api/search/random`);
  }

  let lastError = null;

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ size: 1 })
      });

      if (response.ok) {
        return { 
          success: true, 
          message: `Connected successfully to Immich! API key is valid.` 
        };
      }

      if (response.status === 401 || response.status === 403) {
        return { 
          success: false, 
          message: 'Authentication failed (401/403). Please check that your API Key is valid.' 
        };
      }

      const errText = await response.text();
      return { 
        success: false, 
        message: `Immich returned HTTP ${response.status}: ${errText.slice(0, 100)}` 
      };
    } catch (err) {
      lastError = err;
    }
  }

  return { 
    success: false, 
    message: `CORS / Network Error: ${lastError?.message || 'Failed to fetch'}. Run with 'python3 server.py' to bypass browser CORS.` 
  };
}

/**
 * Fetch random photos from Immich API
 */
export async function fetchRandomAssets(count = 30, isFavoriteOnly = false) {
  const settings = getSettings();

  if (settings.demoMode) {
    return getSampleDemoAssets(count);
  }

  const baseUrl = getApiBaseUrl();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (settings.apiKey) {
    headers['x-api-key'] = settings.apiKey;
  }

  const payload = {
    size: count,
    type: 'IMAGE'
  };

  if (isFavoriteOnly || settings.isFavoriteOnly) {
    payload.isFavorite = true;
  }

  try {
    const url = `${baseUrl}/api/search/random`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('API_KEY_REQUIRED');
      }
      throw new Error(`Immich API error: ${response.status}`);
    }

    const data = await response.json();
    let assets = [];
    if (Array.isArray(data)) {
      assets = data;
    } else if (data && Array.isArray(data.assets)) {
      assets = data.assets;
    } else if (data && Array.isArray(data.items)) {
      assets = data.items;
    }

    const VIDEO_EXTENSIONS = /\.(mp4|mov|mkv|avi|webm|m4v|3gp|wmv|flv|ts|mts|m2ts)$/i;

    return assets
      .filter(raw => {
        if (!raw) return false;
        if (raw.type === 'VIDEO') return false;
        const name = raw.originalFileName || raw.originalPath || '';
        if (VIDEO_EXTENSIONS.test(name)) return false;
        if (raw.duration && raw.duration !== '0:00:00.000000') return false;
        return true;
      })
      .map(normalizeAsset)
      .filter(Boolean);
  } catch (error) {
    console.warn('Failed to fetch from Immich API:', error);
    throw error;
  }
}

/**
 * Normalize Immich asset object structure
 */
function normalizeAsset(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return {
      id: raw,
      originalFileName: 'Photo',
      type: 'IMAGE',
      isFavorite: false,
      isArchived: false,
      dateTaken: null,
      camera: '',
      lens: '',
      exposure: '',
      location: '',
      latitude: null,
      longitude: null,
      description: '',
      width: null,
      height: null,
      aspectRatio: 0.75,
      raw: { id: raw }
    };
  }

  const exif = raw.exifInfo || raw.exif || {};
  
  // Camera
  let camera = '';
  if (exif.make || exif.model) {
    camera = [exif.make, exif.model].filter(Boolean).join(' ');
  }

  // Lens
  const lens = exif.lensModel || '';

  // Exposure
  const exposureParts = [];
  if (exif.focalLength) exposureParts.push(`${Math.round(exif.focalLength)}mm`);
  if (exif.fNumber) exposureParts.push(`ƒ/${exif.fNumber}`);
  if (exif.exposureTime) exposureParts.push(`${exif.exposureTime}s`);
  if (exif.iso) exposureParts.push(`ISO ${exif.iso}`);
  const exposure = exposureParts.join(' • ');

  // Location
  const locationParts = [exif.city, exif.state, exif.country].filter(Boolean);
  const location = locationParts.join(', ');

  const dateTaken = raw.fileCreatedAt || raw.createdAt || raw.fileModifiedAt || raw.dateTimeOriginal;

  // Width, Height, and Aspect Ratio
  const width = exif.exifImageWidth || raw.width || raw.originalWidth || raw.exif?.width || null;
  const height = exif.exifImageHeight || raw.height || raw.originalHeight || raw.exif?.height || null;
  
  let aspectRatio = null;
  if (width && height && width > 0 && height > 0) {
    // If orientation is 6 or 8 (rotated 90 deg), flip aspect ratio
    const orientation = exif.orientation || raw.orientation;
    if (orientation === 6 || orientation === 8 || orientation === '6' || orientation === '8') {
      aspectRatio = height / width;
    } else {
      aspectRatio = width / height;
    }
  } else {
    // Graceful default aspect ratio (3:4 portrait)
    aspectRatio = 0.75;
  }

  const assetId = raw.id || raw.assetId || raw.uuid;
  const localFavs = getLocalFavorites();
  const isFavorite = Boolean(raw.isFavorite) || localFavs.has(assetId);

  return {
    id: assetId,
    originalFileName: raw.originalFileName || raw.originalPath || raw.name || 'Photo',
    type: raw.type || 'IMAGE',
    isFavorite,
    isArchived: Boolean(raw.isArchived),
    duration: raw.duration,
    dateTaken,
    camera,
    lens,
    exposure,
    location,
    latitude: exif.latitude,
    longitude: exif.longitude,
    description: exif.description || raw.description || '',
    width,
    height,
    aspectRatio,
    raw
  };
}

/**
 * Rich sample demo assets for instant preview or offline testing
 */
function getSampleDemoAssets(count = 20) {
  const sampleLibrary = [
    {
      id: 'demo-1',
      title: 'Alpine Morning Glow',
      camera: 'Sony A7 IV',
      lens: 'FE 24-70mm F2.8 GM II',
      exposure: '35mm • ƒ/4.0 • 1/320s • ISO 100',
      location: 'Dolomites, Italy',
      dateTaken: '2024-10-12T07:15:00Z',
      width: 1200,
      height: 1600,
      isFavorite: true,
      url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80'
    },
    {
      id: 'demo-2',
      title: 'Neon Tokyo Street',
      camera: 'Fujifilm X-T5',
      lens: 'XF 33mm F1.4 R LM WR',
      exposure: '33mm • ƒ/1.4 • 1/125s • ISO 800',
      location: 'Shinjuku, Tokyo, Japan',
      dateTaken: '2024-11-04T19:42:00Z',
      width: 1200,
      height: 800,
      isFavorite: true,
      url: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=800&q=80'
    },
    {
      id: 'demo-3',
      title: 'Minimalist Architecture Curve',
      camera: 'Canon EOS R5',
      lens: 'RF 15-35mm F2.8 L IS USM',
      exposure: '18mm • ƒ/8.0 • 1/250s • ISO 100',
      location: 'Valencia, Spain',
      dateTaken: '2024-09-18T14:30:00Z',
      width: 1000,
      height: 1500,
      isFavorite: false,
      url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80'
    },
    {
      id: 'demo-4',
      title: 'Moody Redwood Trail',
      camera: 'Nikon Z8',
      lens: 'NIKKOR Z 24-120mm f/4 S',
      exposure: '45mm • ƒ/5.6 • 1/60s • ISO 400',
      location: 'Muir Woods, California, USA',
      dateTaken: '2024-08-22T10:05:00Z',
      width: 1200,
      height: 1800,
      isFavorite: true,
      url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80'
    },
    {
      id: 'demo-5',
      title: 'Ocean Spray & Coastal Cliffs',
      camera: 'Leica Q3',
      lens: 'Summilux 28mm f/1.7 ASPH',
      exposure: '28mm • ƒ/2.8 • 1/1000s • ISO 50',
      location: 'Big Sur, California, USA',
      dateTaken: '2024-07-30T17:50:00Z',
      width: 1200,
      height: 1200,
      isFavorite: false,
      url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80'
    }
  ];

  const shuffled = [...sampleLibrary].sort(() => Math.random() - 0.5);
  const results = [];
  for (let i = 0; i < count; i++) {
    const template = shuffled[i % shuffled.length];
    const uniqueId = `demo-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 6)}`;
    results.push({
      id: uniqueId,
      originalFileName: `${template.title.toLowerCase().replace(/\s+/g, '_')}.jpg`,
      type: 'IMAGE',
      isFavorite: template.isFavorite,
      isArchived: false,
      dateTaken: template.dateTaken,
      camera: template.camera,
      lens: template.lens,
      exposure: template.exposure,
      location: template.location,
      latitude: null,
      longitude: null,
      description: template.title,
      width: template.width,
      height: template.height,
      aspectRatio: template.width / template.height,
      isDemo: true,
      demoUrl: template.url,
      demoOriginalUrl: template.url
    });
  }

  return results;
}
