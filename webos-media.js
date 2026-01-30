/**
 * WebOS Native Media Playback
 * 
 * Uses com.webos.media Luna service for hardware-accelerated playback
 * with native DVB subtitle support.
 */

// ============================================================
// WebOS Detection
// ============================================================

/**
 * Check if running on webOS TV
 */
export function isWebOS() {
    if (typeof window === 'undefined') return false;
    
    // Method 1: Check for webOS global object
    if (typeof window.webOS !== 'undefined') {
        console.log('[WebOS] Detected via window.webOS');
        return true;
    }
    
    // Method 2: Check for PalmSystem (older webOS)
    if (typeof window.PalmSystem !== 'undefined') {
        console.log('[WebOS] Detected via PalmSystem');
        return true;
    }
    
    // Method 3: Check for WebOSServiceBridge
    if (typeof window.WebOSServiceBridge !== 'undefined') {
        console.log('[WebOS] Detected via WebOSServiceBridge');
        return true;
    }
    
    // Method 4: Check user agent
    const ua = navigator.userAgent || '';
    if (/Web0S|webOS|WEBOS/i.test(ua)) {
        console.log('[WebOS] Detected via User Agent:', ua);
        return true;
    }
    
    // Method 5: Check for LG TV markers
    if (/LG.*SmartTV|LGE|LGTV|NetCast/i.test(ua)) {
        console.log('[WebOS] Detected via LG TV UA:', ua);
        return true;
    }
    
    console.log('[WebOS] Not detected. UA:', ua);
    return false;
}

/**
 * Get webOS version string for display
 */
export function getWebOSVersion() {
    const ua = navigator.userAgent || '';
    
    // Try Chrome version mapping
    const chromeMatch = ua.match(/Chrome\/(\d+)/);
    if (chromeMatch) {
        const v = parseInt(chromeMatch[1]);
        if (v >= 120) return 'TV25';
        if (v >= 108) return 'TV24';
        if (v >= 94) return 'TV23';
        if (v >= 87) return 'TV22';
        if (v >= 79) return 'TV6';
        if (v >= 68) return 'TV5';
        if (v >= 53) return 'TV4';
        if (v >= 38) return 'TV3';
    }
    
    return '';
}

// ============================================================
// Luna Service Bridge
// ============================================================

/**
 * Create a Luna service bridge
 */
function createBridge() {
    if (typeof window.WebOSServiceBridge !== 'undefined') {
        return new window.WebOSServiceBridge();
    }
    return null;
}

/**
 * Make a Luna service call
 */
function lunaCall(uri, params = {}) {
    return new Promise((resolve, reject) => {
        const bridge = createBridge();
        if (!bridge) {
            reject(new Error('WebOSServiceBridge not available'));
            return;
        }
        
        console.log('[Luna] Calling:', uri, JSON.stringify(params));
        
        bridge.onservicecallback = (response) => {
            try {
                const result = JSON.parse(response);
                console.log('[Luna] Response:', JSON.stringify(result).substring(0, 200));
                
                if (result.returnValue === false) {
                    reject(new Error(result.errorText || 'Luna call failed'));
                } else {
                    resolve(result);
                }
            } catch (e) {
                reject(new Error('Failed to parse response: ' + e.message));
            }
        };
        
        bridge.call(uri, JSON.stringify(params));
    });
}

/**
 * Subscribe to Luna service events
 */
function lunaSubscribe(uri, params = {}, onMessage) {
    const bridge = createBridge();
    if (!bridge) {
        console.error('[Luna] Cannot subscribe - no bridge');
        return null;
    }
    
    params.subscribe = true;
    console.log('[Luna] Subscribing:', uri);
    
    bridge.onservicecallback = (response) => {
        try {
            const result = JSON.parse(response);
            onMessage(result);
        } catch (e) {
            console.error('[Luna] Parse error:', e);
        }
    };
    
    bridge.call(uri, JSON.stringify(params));
    return bridge;
}

// ============================================================
// WebOS Media Player Class
// ============================================================

export class WebOSMediaPlayer {
    constructor() {
        this.mediaId = null;
        this.subscription = null;
        this.appId = 'com.hdhr.streamdebug';
        this.isPlaying = false;
        this.listeners = {};
        
        // Get app ID
        this._detectAppId();
    }
    
    _detectAppId() {
        try {
            if (window.webOS && window.webOS.fetchAppId) {
                this.appId = window.webOS.fetchAppId();
            } else if (window.PalmSystem && window.PalmSystem.identifier) {
                this.appId = window.PalmSystem.identifier;
            }
        } catch (e) {
            console.log('[WebOS] Using default appId');
        }
        console.log('[WebOS] App ID:', this.appId);
    }
    
    /**
     * Add event listener
     */
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
        return this;
    }
    
    /**
     * Emit event
     */
    _emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error('[WebOS] Event error:', e); }
            });
        }
    }
    
    /**
     * Load and play media
     */
    async load(url) {
        // Unload any existing media first
        if (this.mediaId) {
            await this.unload();
        }
        
        try {
            console.log('[WebOS] Loading:', url);
            
            const result = await lunaCall('luna://com.webos.media/load', {
                uri: url,
                type: 'media',
                payload: {
                    option: {
                        appId: this.appId,
                        windowId: '_Window_Id_1'
                    }
                }
            });
            
            if (result.mediaId) {
                this.mediaId = result.mediaId;
                console.log('[WebOS] Media loaded, ID:', this.mediaId);
                
                // Subscribe to events
                this._subscribe();
                
                this._emit('loaded', { mediaId: this.mediaId });
                return true;
            }
            
            return false;
            
        } catch (err) {
            console.error('[WebOS] Load error:', err);
            this._emit('error', { message: err.message });
            return false;
        }
    }
    
    /**
     * Subscribe to media events
     */
    _subscribe() {
        if (!this.mediaId) return;
        
        this.subscription = lunaSubscribe(
            'luna://com.webos.media/subscribe',
            { mediaId: this.mediaId },
            (event) => this._handleEvent(event)
        );
    }
    
    /**
     * Handle media events
     */
    _handleEvent(event) {
        // Source info - contains stream details including subtitles
        if (event.sourceInfo) {
            console.log('[WebOS] Source info:', JSON.stringify(event.sourceInfo));
            this._emit('sourceInfo', event.sourceInfo);
            
            // Log program info
            if (event.sourceInfo.programInfo) {
                event.sourceInfo.programInfo.forEach((prog, i) => {
                    console.log(`[WebOS] Program ${i}:`, JSON.stringify(prog));
                    
                    if (prog.subtitleStreamInfo) {
                        console.log('[WebOS] Subtitles found:', prog.subtitleStreamInfo);
                        this._emit('subtitles', prog.subtitleStreamInfo);
                    }
                });
            }
        }
        
        // Playback state
        if (event.playing !== undefined) {
            this.isPlaying = event.playing;
            this._emit(event.playing ? 'playing' : 'paused');
        }
        
        if (event.endOfStream) {
            this.isPlaying = false;
            this._emit('ended');
        }
        
        if (event.error) {
            console.error('[WebOS] Playback error:', event.error);
            this._emit('error', event.error);
        }
        
        // Current time
        if (event.currentTime !== undefined) {
            this._emit('timeupdate', event.currentTime / 1000);
        }
        
        // Buffer state
        if (event.bufferingStart) this._emit('buffering', true);
        if (event.bufferingEnd) this._emit('buffering', false);
    }
    
    /**
     * Start playback
     */
    async play() {
        if (!this.mediaId) return false;
        
        try {
            await lunaCall('luna://com.webos.media/play', {
                mediaId: this.mediaId
            });
            return true;
        } catch (err) {
            console.error('[WebOS] Play error:', err);
            return false;
        }
    }
    
    /**
     * Pause playback
     */
    async pause() {
        if (!this.mediaId) return false;
        
        try {
            await lunaCall('luna://com.webos.media/pause', {
                mediaId: this.mediaId
            });
            return true;
        } catch (err) {
            console.error('[WebOS] Pause error:', err);
            return false;
        }
    }
    
    /**
     * Seek to position (seconds)
     */
    async seek(position) {
        if (!this.mediaId) return false;
        
        try {
            await lunaCall('luna://com.webos.media/seek', {
                mediaId: this.mediaId,
                position: Math.floor(position * 1000) // Convert to ms
            });
            return true;
        } catch (err) {
            console.error('[WebOS] Seek error:', err);
            return false;
        }
    }
    
    /**
     * Set volume (0-100)
     */
    async setVolume(volume) {
        if (!this.mediaId) return false;
        
        try {
            await lunaCall('luna://com.webos.media/setVolume', {
                mediaId: this.mediaId,
                volume: Math.max(0, Math.min(100, volume))
            });
            return true;
        } catch (err) {
            console.error('[WebOS] Volume error:', err);
            return false;
        }
    }
    
    /**
     * Select subtitle track
     */
    async selectSubtitle(index) {
        if (!this.mediaId) return false;
        
        try {
            await lunaCall('luna://com.webos.media/selectTrack', {
                mediaId: this.mediaId,
                type: 'text',
                index: index
            });
            console.log('[WebOS] Selected subtitle track:', index);
            return true;
        } catch (err) {
            console.error('[WebOS] Subtitle select error:', err);
            return false;
        }
    }
    
    /**
     * Unload media
     */
    async unload() {
        if (!this.mediaId) return true;
        
        try {
            // Cancel subscription
            if (this.subscription) {
                try { this.subscription.cancel(); } catch (e) {}
                this.subscription = null;
            }
            
            await lunaCall('luna://com.webos.media/unload', {
                mediaId: this.mediaId
            });
            
            console.log('[WebOS] Unloaded:', this.mediaId);
            this.mediaId = null;
            this.isPlaying = false;
            this._emit('unloaded');
            return true;
            
        } catch (err) {
            console.error('[WebOS] Unload error:', err);
            this.mediaId = null;
            return false;
        }
    }
    
    /**
     * Check if media is loaded
     */
    isLoaded() {
        return this.mediaId !== null;
    }
}

// ============================================================
// Simple Test Function
// ============================================================

/**
 * Quick test to verify Luna service is working
 */
export async function testLunaService() {
    console.log('=== WebOS Luna Service Test ===');
    console.log('isWebOS():', isWebOS());
    console.log('getWebOSVersion():', getWebOSVersion());
    console.log('WebOSServiceBridge:', typeof window.WebOSServiceBridge);
    console.log('window.webOS:', typeof window.webOS);
    console.log('PalmSystem:', typeof window.PalmSystem);
    
    if (!isWebOS()) {
        console.log('Not running on WebOS');
        return false;
    }
    
    try {
        // Try a simple Luna call
        const result = await lunaCall('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
            keys: ['modelName', 'firmwareVersion', 'sdkVersion']
        });
        console.log('System info:', result);
        return true;
    } catch (err) {
        console.error('Luna test failed:', err);
        return false;
    }
}

// Make test available globally for console debugging
if (typeof window !== 'undefined') {
    window.testLunaService = testLunaService;
    window.isWebOS = isWebOS;
}
