/**
 * WebOS Native Media Playback using Luna Services
 * 
 * Uses com.webos.media Luna API for hardware-accelerated playback
 * with native DVB subtitle support (same as DLNA player uses).
 * 
 * This bypasses the HTML5 video element limitations and uses
 * the native webOS media pipeline which has full codec and
 * subtitle support.
 * 
 * Requirements:
 * - Must run on webOS TV (not in browser)
 * - App needs appropriate permissions in appinfo.json
 * - Uses WebOSServiceBridge for Luna calls
 */

export class WebOSMediaPlayer {
    constructor(options = {}) {
        this.onLog = options.onLog || console.log;
        this.onError = options.onError || console.error;
        this.onStateChange = options.onStateChange || (() => {});
        this.onTimeUpdate = options.onTimeUpdate || (() => {});
        this.onSourceInfo = options.onSourceInfo || (() => {});
        this.onSubtitleData = options.onSubtitleData || (() => {});
        
        this.mediaId = null;
        this.windowId = null;
        this.appId = null;
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;
        this.sourceInfo = null;
        
        // WebOS detection
        this.isWebOS = this.detectWebOS();
        this.bridge = null;
        
        // Subscription handles
        this.subscriptionHandle = null;
        
        // Event listeners
        this.eventListeners = new Map();
    }
    
    /**
     * Add event listener
     * Supported events: playing, paused, ended, error, sourceInfo, currentTime, bufferRange
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
        return this;
    }
    
    /**
     * Remove event listener
     */
    off(event, callback) {
        if (!this.eventListeners.has(event)) return this;
        const listeners = this.eventListeners.get(event);
        const idx = listeners.indexOf(callback);
        if (idx > -1) listeners.splice(idx, 1);
        return this;
    }
    
    /**
     * Emit event to listeners
     */
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    this.onError(`Event handler error: ${e.message}`);
                }
            });
        }
    }
    
    /**
     * Detect if running on webOS
     */
    detectWebOS() {
        if (typeof window === 'undefined') return false;
        
        // Check for webOS indicators
        const ua = navigator.userAgent || '';
        const isWebOS = ua.includes('Web0S') || 
                        ua.includes('webOS') || 
                        typeof window.webOS !== 'undefined' ||
                        typeof window.PalmSystem !== 'undefined';
        
        if (isWebOS) {
            this.onLog('WebOS detected');
        } else {
            this.onLog('Not running on webOS - native playback unavailable');
        }
        
        return isWebOS;
    }
    
    /**
     * Initialize the Luna service bridge
     */
    async init() {
        if (!this.isWebOS) {
            this.onError('WebOS native playback requires running on webOS TV');
            return false;
        }
        
        try {
            // Try to create WebOSServiceBridge
            if (typeof WebOSServiceBridge !== 'undefined') {
                this.bridge = new WebOSServiceBridge();
                this.onLog('WebOSServiceBridge initialized');
            } else if (typeof window.webOS !== 'undefined' && window.webOS.service) {
                // Alternative: use webOS.service.request
                this.bridge = 'webOS.service';
                this.onLog('Using webOS.service for Luna calls');
            } else {
                throw new Error('No Luna service bridge available');
            }
            
            // Get app ID from webOS
            this.appId = await this.getAppId();
            this.onLog(`App ID: ${this.appId}`);
            
            return true;
            
        } catch (err) {
            this.onError(`Init failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Get the app ID from webOS
     */
    async getAppId() {
        // Try multiple methods
        if (typeof window.webOS !== 'undefined' && window.webOS.fetchAppId) {
            return window.webOS.fetchAppId();
        }
        
        if (typeof PalmSystem !== 'undefined' && PalmSystem.identifier) {
            return PalmSystem.identifier;
        }
        
        // Fallback - read from appinfo.json would need a fetch
        return 'com.hdhr.streamdebug'; // Default from our appinfo.json
    }
    
    /**
     * Make a Luna service call
     */
    lunaCall(uri, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.bridge) {
                reject(new Error('Luna bridge not initialized'));
                return;
            }
            
            const paramsStr = JSON.stringify(params);
            this.onLog(`Luna call: ${uri} ${paramsStr.substring(0, 100)}...`);
            
            if (this.bridge === 'webOS.service') {
                // Use webOS.service.request
                window.webOS.service.request(uri, {
                    parameters: params,
                    onSuccess: (res) => {
                        this.onLog(`Luna success: ${JSON.stringify(res).substring(0, 100)}...`);
                        resolve(res);
                    },
                    onFailure: (err) => {
                        this.onError(`Luna error: ${JSON.stringify(err)}`);
                        reject(new Error(err.errorText || 'Luna call failed'));
                    }
                });
            } else {
                // Use WebOSServiceBridge
                const callback = (response) => {
                    try {
                        const res = JSON.parse(response);
                        if (res.returnValue === false) {
                            reject(new Error(res.errorText || 'Luna call failed'));
                        } else {
                            resolve(res);
                        }
                    } catch (e) {
                        reject(e);
                    }
                };
                
                this.bridge.onservicecallback = callback;
                this.bridge.call(uri, paramsStr);
            }
        });
    }
    
    /**
     * Subscribe to Luna service events
     */
    lunaSubscribe(uri, params = {}, onMessage) {
        if (!this.bridge) {
            this.onError('Luna bridge not initialized');
            return null;
        }
        
        params.subscribe = true;
        const paramsStr = JSON.stringify(params);
        
        if (this.bridge === 'webOS.service') {
            return window.webOS.service.request(uri, {
                parameters: params,
                onSuccess: onMessage,
                onFailure: (err) => this.onError(`Subscription error: ${err.errorText}`),
                subscribe: true
            });
        } else {
            // WebOSServiceBridge subscription
            const bridge = new WebOSServiceBridge();
            bridge.onservicecallback = (response) => {
                try {
                    onMessage(JSON.parse(response));
                } catch (e) {
                    this.onError(`Parse error: ${e.message}`);
                }
            };
            bridge.call(uri, paramsStr);
            return bridge;
        }
    }
    
    /**
     * Load media using native webOS pipeline
     * This is equivalent to what DLNA player does
     */
    async load(url, options = {}) {
        if (!this.bridge) {
            await this.init();
        }
        
        if (!this.isWebOS) {
            this.onError('Native playback requires webOS');
            return false;
        }
        
        try {
            // First unload any existing media
            if (this.mediaId) {
                await this.unload();
            }
            
            // Get window ID - in webOS apps this is typically provided
            this.windowId = options.windowId || '_Window_Id_1';
            
            // Load the media
            const loadParams = {
                uri: url,
                type: 'media',
                payload: {
                    option: {
                        appId: this.appId,
                        windowId: this.windowId,
                        // Enable subtitle rendering
                        // Note: actual subtitle params may vary by webOS version
                    }
                }
            };
            
            this.onLog(`Loading media: ${url}`);
            const result = await this.lunaCall('luna://com.webos.media/load', loadParams);
            
            if (result.mediaId) {
                this.mediaId = result.mediaId;
                this.onLog(`Media loaded: ${this.mediaId}`);
                
                // Subscribe to media events
                await this.subscribe();
                
                this.onStateChange('loaded');
                return true;
            }
            
            return false;
            
        } catch (err) {
            this.onError(`Load failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Subscribe to media events (currentTime, sourceInfo, etc.)
     */
    async subscribe() {
        if (!this.mediaId) return;
        
        this.subscriptionHandle = this.lunaSubscribe(
            'luna://com.webos.media/subscribe',
            { mediaId: this.mediaId },
            (event) => this.handleMediaEvent(event)
        );
    }
    
    /**
     * Handle media events from subscription
     */
    handleMediaEvent(event) {
        // Current time updates
        if (event.currentTime !== undefined) {
            this.currentTime = event.currentTime / 1000; // Convert ms to seconds
            this.onTimeUpdate(this.currentTime, this.duration);
            this.emit('currentTime', this.currentTime);
        }
        
        // Source info (includes stream details)
        if (event.sourceInfo) {
            this.sourceInfo = event.sourceInfo;
            this.duration = (event.sourceInfo.duration || 0) / 1000;
            
            this.onLog(`Source info: ${JSON.stringify(event.sourceInfo).substring(0, 200)}...`);
            this.onSourceInfo(event.sourceInfo);
            this.emit('sourceInfo', event.sourceInfo);
            
            // Log subtitle streams if present
            if (event.sourceInfo.subtitle_streams) {
                this.onLog(`Subtitle streams found: ${event.sourceInfo.subtitle_streams.length}`);
                event.sourceInfo.subtitle_streams.forEach((sub, i) => {
                    this.onLog(`  Subtitle ${i}: ${JSON.stringify(sub)}`);
                });
            }
        }
        
        // Video info
        if (event.videoInfo) {
            this.onLog(`Video info: ${JSON.stringify(event.videoInfo)}`);
        }
        
        // Audio info
        if (event.audioInfo) {
            this.onLog(`Audio info: ${JSON.stringify(event.audioInfo)}`);
        }
        
        // Playback state changes
        if (event.loadCompleted) {
            this.onStateChange('loadCompleted');
        }
        if (event.playing) {
            this.isPlaying = true;
            this.onStateChange('playing');
            this.emit('playing');
        }
        if (event.paused) {
            this.isPlaying = false;
            this.onStateChange('paused');
            this.emit('paused');
        }
        if (event.endOfStream) {
            this.isPlaying = false;
            this.onStateChange('ended');
            this.emit('ended');
        }
        if (event.error) {
            this.onError(`Playback error: ${event.error.errorText}`);
            this.onStateChange('error');
            this.emit('error', event.error);
        }
        
        // Buffer events
        if (event.bufferingStart) {
            this.onStateChange('buffering');
        }
        if (event.bufferingEnd) {
            this.onStateChange('ready');
        }
        
        // Buffer range
        if (event.bufferRange) {
            this.emit('bufferRange', event.bufferRange);
        }
    }
    
    /**
     * Play the loaded media
     */
    async play() {
        if (!this.mediaId) {
            this.onError('No media loaded');
            return false;
        }
        
        try {
            await this.lunaCall('luna://com.webos.media/play', {
                mediaId: this.mediaId
            });
            this.isPlaying = true;
            return true;
        } catch (err) {
            this.onError(`Play failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Pause playback
     */
    async pause() {
        if (!this.mediaId) return false;
        
        try {
            await this.lunaCall('luna://com.webos.media/pause', {
                mediaId: this.mediaId
            });
            this.isPlaying = false;
            return true;
        } catch (err) {
            this.onError(`Pause failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Seek to position (in seconds)
     */
    async seek(positionSeconds) {
        if (!this.mediaId) return false;
        
        try {
            await this.lunaCall('luna://com.webos.media/seek', {
                mediaId: this.mediaId,
                position: Math.floor(positionSeconds * 1000) // Convert to ms
            });
            return true;
        } catch (err) {
            this.onError(`Seek failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Set playback rate
     */
    async setPlayRate(rate, audioOutput = true) {
        if (!this.mediaId) return false;
        
        try {
            await this.lunaCall('luna://com.webos.media/setPlayRate', {
                mediaId: this.mediaId,
                playRate: rate,
                audioOutput: audioOutput
            });
            return true;
        } catch (err) {
            this.onError(`SetPlayRate failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Set volume (0-100)
     */
    async setVolume(volume) {
        if (!this.mediaId) return false;
        
        try {
            await this.lunaCall('luna://com.webos.media/setVolume', {
                mediaId: this.mediaId,
                volume: Math.max(0, Math.min(100, Math.floor(volume)))
            });
            return true;
        } catch (err) {
            this.onError(`SetVolume failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Check if media is loaded
     */
    isLoaded() {
        return this.mediaId !== null;
    }
    
    /**
     * Unload media and release resources
     */
    async unload() {
        if (!this.mediaId) return true;
        
        try {
            // Unsubscribe first
            if (this.subscriptionHandle) {
                if (typeof this.subscriptionHandle.cancel === 'function') {
                    this.subscriptionHandle.cancel();
                }
                this.subscriptionHandle = null;
            }
            
            await this.lunaCall('luna://com.webos.media/unload', {
                mediaId: this.mediaId
            });
            
            this.mediaId = null;
            this.isPlaying = false;
            this.currentTime = 0;
            this.sourceInfo = null;
            this.onStateChange('unloaded');
            
            return true;
        } catch (err) {
            this.onError(`Unload failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Get current pipeline state
     */
    async getPipelineState() {
        if (!this.mediaId) return null;
        
        try {
            const result = await this.lunaCall('luna://com.webos.media/getPipelineState', {
                mediaId: this.mediaId
            });
            
            if (result.data) {
                return JSON.parse(result.data);
            }
            return result;
        } catch (err) {
            this.onError(`GetPipelineState failed: ${err.message}`);
            return null;
        }
    }
    
    /**
     * Get active pipelines (for debugging)
     */
    async getActivePipelines() {
        try {
            return await this.lunaCall('luna://com.webos.media/getActivePipelines', {});
        } catch (err) {
            this.onError(`GetActivePipelines failed: ${err.message}`);
            return null;
        }
    }
    
    /**
     * Check if webOS native playback is available
     */
    static isAvailable() {
        if (typeof window === 'undefined') return false;
        
        const ua = navigator.userAgent || '';
        return ua.includes('Web0S') || 
               ua.includes('webOS') || 
               typeof window.webOS !== 'undefined' ||
               typeof window.PalmSystem !== 'undefined';
    }
    
    /**
     * Get compatibility info
     */
    getCompatibility() {
        return {
            isWebOS: this.isWebOS,
            hasBridge: !!this.bridge,
            appId: this.appId,
            mediaId: this.mediaId,
            recommendation: this.isWebOS 
                ? 'Native playback available - full DVB subtitle support'
                : 'Not on webOS - use HTML5 video with mpegts.js'
        };
    }
}

/**
 * Quick check for webOS availability
 */
export function isWebOS() {
    return WebOSMediaPlayer.isAvailable();
}

/**
 * Get webOS version info
 */
export function getWebOSVersion() {
    if (typeof window === 'undefined') return null;
    
    const ua = navigator.userAgent || '';
    
    // Try to extract version from UA
    // Example: "Chrome/108.0.5359.211" indicates webOS TV 24
    const chromeMatch = ua.match(/Chrome\/(\d+)/);
    if (chromeMatch) {
        const chromeVersion = parseInt(chromeMatch[1]);
        
        // Map Chrome versions to webOS versions
        const versionMap = {
            120: 'webOS TV 25 (2025)',
            108: 'webOS TV 24 (2024)',
            94: 'webOS TV 23 (2023)',
            87: 'webOS TV 22 (2022)',
            79: 'webOS TV 6.x (2021)',
            68: 'webOS TV 5.x (2020)',
            53: 'webOS TV 4.x (2018-2019)',
            38: 'webOS TV 3.x (2016-2017)'
        };
        
        // Find closest match
        for (const [ver, name] of Object.entries(versionMap)) {
            if (chromeVersion >= parseInt(ver)) {
                return { chromeVersion, webOSVersion: name };
            }
        }
    }
    
    return { chromeVersion: null, webOSVersion: 'Unknown webOS version' };
}
