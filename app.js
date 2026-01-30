// Stream Debugger - Main Application with mpegts.js integration

import { discoverHDHR, discoverByIP, scanSubnet, detectLocalSubnet } from './discovery.js';

// ========================
// DOM Elements
// ========================

const video = document.getElementById('videoPlayer');
const streamUrlInput = document.getElementById('streamUrl');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const discoverBtn = document.getElementById('discoverBtn');
const useMpegtsCheckbox = document.getElementById('useMpegts');
const eventsLog = document.getElementById('eventsLog');
const clearEventsBtn = document.getElementById('clearEventsBtn');

// Status elements
const statusState = document.getElementById('statusState');
const statusReady = document.getElementById('statusReady');
const statusResolution = document.getElementById('statusResolution');
const statusCodec = document.getElementById('statusCodec');
const statusBitrate = document.getElementById('statusBitrate');
const statusBuffered = document.getElementById('statusBuffered');
const statusDropped = document.getElementById('statusDropped');

// Tab elements
const streamTab = document.getElementById('streamTab');
const videoTab = document.getElementById('videoTab');
const mpegtsTab = document.getElementById('mpegtsTab');

// Discovery elements
const discoveryOverlay = document.getElementById('discoveryOverlay');
const discoveryContent = document.getElementById('discoveryContent');
const manualIPInput = document.getElementById('manualIP');
const connectManualBtn = document.getElementById('connectManualBtn');
const closeDiscoveryBtn = document.getElementById('closeDiscoveryBtn');

// ========================
// State
// ========================

let mpegtsPlayer = null;
let mediaInfo = null;
let statisticsInfo = null;
let expandedNodes = new Set(['video', 'mediaInfo', 'statisticsInfo']);
let allExpanded = false;

// ========================
// Video Event Logging
// ========================

const videoEvents = [
    'loadstart', 'progress', 'suspend', 'abort', 'error', 'emptied', 'stalled',
    'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing',
    'waiting', 'seeking', 'seeked', 'ended', 'durationchange', 'timeupdate',
    'play', 'pause', 'ratechange', 'resize', 'volumechange'
];

function logEvent(eventName, detail = '', type = 'info') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
    const item = document.createElement('div');
    item.className = 'event-item';
    
    let nameClass = 'event-name';
    if (type === 'error') nameClass += ' error';
    if (type === 'success') nameClass += ' success';
    
    item.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="${nameClass}">${eventName}</span>
        ${detail ? `<span class="event-detail">${detail}</span>` : ''}
    `;
    eventsLog.insertBefore(item, eventsLog.firstChild);
    
    // Keep only last 200 events
    while (eventsLog.children.length > 200) {
        eventsLog.removeChild(eventsLog.lastChild);
    }
}

videoEvents.forEach(eventName => {
    video.addEventListener(eventName, (e) => {
        let detail = '';
        let type = 'info';
        
        if (eventName === 'error' && video.error) {
            detail = `code: ${video.error.code}, message: ${video.error.message || 'unknown'}`;
            type = 'error';
        } else if (eventName === 'loadedmetadata') {
            detail = `${video.videoWidth}x${video.videoHeight}`;
            type = 'success';
        } else if (eventName === 'canplay' || eventName === 'canplaythrough') {
            type = 'success';
        } else if (eventName === 'durationchange') {
            detail = video.duration === Infinity ? 'LIVE' : `${video.duration}s`;
        } else if (eventName === 'progress' && video.buffered.length > 0) {
            detail = `buffered: ${video.buffered.end(video.buffered.length - 1).toFixed(1)}s`;
        } else if (eventName === 'stalled' || eventName === 'waiting') {
            type = 'error';
        }
        
        logEvent(eventName, detail, type);
        updateStatus();
        refreshAllTabs();
    });
});

clearEventsBtn.addEventListener('click', () => {
    eventsLog.innerHTML = '';
});

// ========================
// mpegts.js Integration
// ========================

function initMpegtsPlayer(url) {
    if (!window.mpegts || !mpegts.isSupported()) {
        logEvent('mpegts', 'mpegts.js not supported in this browser', 'error');
        return null;
    }
    
    logEvent('mpegts', 'Initializing mpegts.js player', 'info');
    
    const player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: url
    }, {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 128 * 1024,
        lazyLoad: false,
        lazyLoadMaxDuration: 3 * 60,
        lazyLoadRecoverDuration: 30,
        deferLoadAfterSourceOpen: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 3 * 60,
        autoCleanupMinBackwardDuration: 2 * 60,
        fixAudioTimestampGap: true,
        accurateSeek: true,
        seekType: 'range',
        rangeLoadZeroStart: false,
        reuseRedirectedURL: false,
        referrerPolicy: 'no-referrer-when-downgrade'
    });
    
    // Attach event listeners
    player.on(mpegts.Events.ERROR, (errType, errDetail, errInfo) => {
        logEvent('mpegts-error', `${errType}: ${errDetail}`, 'error');
        console.error('mpegts error:', errType, errDetail, errInfo);
    });
    
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
        logEvent('mpegts', 'Loading complete', 'success');
    });
    
    player.on(mpegts.Events.RECOVERED_EARLY_EOF, () => {
        logEvent('mpegts', 'Recovered from early EOF', 'info');
    });
    
    player.on(mpegts.Events.MEDIA_INFO, (info) => {
        mediaInfo = info;
        logEvent('mpegts-media-info', `Video: ${info.videoCodec || 'none'}, Audio: ${info.audioCodec || 'none'}`, 'success');
        console.log('Media Info:', info);
        updateStatus();
        refreshAllTabs();
    });
    
    player.on(mpegts.Events.METADATA_ARRIVED, (metadata) => {
        logEvent('mpegts-metadata', JSON.stringify(metadata).substring(0, 100), 'info');
        console.log('Metadata:', metadata);
    });
    
    player.on(mpegts.Events.SCRIPTDATA_ARRIVED, (data) => {
        logEvent('mpegts-scriptdata', 'Script data received', 'info');
        console.log('Script Data:', data);
    });
    
    player.on(mpegts.Events.STATISTICS_INFO, (stats) => {
        statisticsInfo = stats;
        // Don't log every stats update - too noisy
    });
    
    return player;
}

// ========================
// Status Updates
// ========================

function updateStatus() {
    // State
    let state = 'idle';
    if (video.error) state = 'error';
    else if (video.ended) state = 'ended';
    else if (video.paused && video.currentTime > 0) state = 'paused';
    else if (video.paused) state = 'stopped';
    else if (video.seeking) state = 'seeking';
    else if (video.readyState < 3) state = 'buffering';
    else if (!video.paused) state = 'playing';
    
    statusState.textContent = state;
    statusState.classList.toggle('error', state === 'error');
    statusState.classList.toggle('warning', state === 'buffering');
    
    // Ready State
    const readyStates = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
    statusReady.textContent = `${video.readyState} (${readyStates[video.readyState] || '?'})`;
    
    // Resolution
    if (video.videoWidth && video.videoHeight) {
        statusResolution.textContent = `${video.videoWidth}x${video.videoHeight}`;
    } else {
        statusResolution.textContent = '-';
    }
    
    // Codec from mpegts.js
    if (mediaInfo) {
        const codecs = [];
        if (mediaInfo.videoCodec) codecs.push(mediaInfo.videoCodec);
        if (mediaInfo.audioCodec) codecs.push(mediaInfo.audioCodec);
        statusCodec.textContent = codecs.length > 0 ? codecs.join(' / ') : '-';
    } else {
        statusCodec.textContent = '-';
    }
    
    // Bitrate from statistics
    if (statisticsInfo && statisticsInfo.speed) {
        statusBitrate.textContent = `${(statisticsInfo.speed * 8 / 1024).toFixed(0)} kbps`;
    } else {
        statusBitrate.textContent = '-';
    }
    
    // Buffered
    if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferedAhead = bufferedEnd - video.currentTime;
        statusBuffered.textContent = `${bufferedAhead.toFixed(1)}s`;
    } else {
        statusBuffered.textContent = '-';
    }
    
    // Dropped frames
    if (statisticsInfo && typeof statisticsInfo.droppedVideoFrames !== 'undefined') {
        const dropped = statisticsInfo.droppedVideoFrames;
        statusDropped.textContent = dropped.toString();
        statusDropped.classList.toggle('warning', dropped > 0);
        statusDropped.classList.toggle('error', dropped > 10);
    } else if (video.webkitDroppedFrameCount !== undefined) {
        statusDropped.textContent = video.webkitDroppedFrameCount.toString();
    } else {
        statusDropped.textContent = '-';
    }
}

// ========================
// Tree View Renderer
// ========================

function getType(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (value instanceof HTMLElement) return 'element';
    if (value instanceof TimeRanges) return 'TimeRanges';
    if (value instanceof MediaError) return 'MediaError';
    if (value instanceof TextTrackList) return 'TextTrackList';
    if (value instanceof AudioTrackList) return 'AudioTrackList';
    if (value instanceof VideoTrackList) return 'VideoTrackList';
    if (typeof value === 'object' && value !== null && value.constructor && value.constructor.name) {
        return value.constructor.name;
    }
    return typeof value;
}

function getPreview(value, type) {
    try {
        switch (type) {
            case 'string':
                return `"${value.length > 40 ? value.substring(0, 40) + '...' : value}"`;
            case 'number':
                return typeof value === 'number' && !isNaN(value) ? 
                    (Number.isInteger(value) ? value.toString() : value.toFixed(4)) : String(value);
            case 'boolean':
                return String(value);
            case 'null':
                return 'null';
            case 'undefined':
                return 'undefined';
            case 'function':
                return 'ƒ()';
            case 'array':
                return `Array(${value.length})`;
            case 'TimeRanges':
                return `TimeRanges(${value.length})`;
            case 'TextTrackList':
                return `TextTrackList(${value.length})`;
            case 'AudioTrackList':
                return `AudioTrackList(${value.length})`;
            case 'VideoTrackList':
                return `VideoTrackList(${value.length})`;
            case 'MediaError':
                return `MediaError(${value.code})`;
            case 'object':
            default:
                if (value && typeof value === 'object') {
                    const keys = Object.keys(value);
                    if (keys.length === 0) return '{}';
                    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
                }
                return String(value);
        }
    } catch (e) {
        return '[Error]';
    }
}

function isExpandable(value, type) {
    if (value === null || value === undefined) return false;
    if (type === 'function') return false;
    return ['object', 'array', 'TimeRanges', 'TextTrackList', 'AudioTrackList', 
            'VideoTrackList', 'MediaError', 'Object', 'HTMLVideoElement'].includes(type) ||
           (typeof value === 'object' && Object.keys(value).length > 0);
}

function renderValue(value, type) {
    try {
        switch (type) {
            case 'string':
                const str = value.length > 60 ? value.substring(0, 60) + '...' : value;
                return `<span class="tree-string">"${escapeHtml(str)}"</span>`;
            case 'number':
                const numStr = typeof value === 'number' && !isNaN(value) ?
                    (Number.isInteger(value) ? value.toString() : value.toFixed(4)) : String(value);
                return `<span class="tree-number">${numStr}</span>`;
            case 'boolean':
                return `<span class="tree-boolean">${value}</span>`;
            case 'null':
                return `<span class="tree-null">null</span>`;
            case 'undefined':
                return `<span class="tree-null">undefined</span>`;
            case 'function':
                return `<span class="tree-function">ƒ ${value.name || 'anonymous'}()</span>`;
            default:
                return `<span class="tree-preview">${escapeHtml(getPreview(value, type))}</span>`;
        }
    } catch (e) {
        return `<span class="tree-null">[Error: ${e.message}]</span>`;
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getObjectEntries(value, type) {
    const entries = [];
    
    try {
        if (type === 'TimeRanges') {
            for (let i = 0; i < value.length; i++) {
                entries.push([`[${i}]`, { start: value.start(i), end: value.end(i) }]);
            }
            entries.push(['length', value.length]);
        } else if (type === 'TextTrackList' || type === 'AudioTrackList' || type === 'VideoTrackList') {
            for (let i = 0; i < value.length; i++) {
                const track = value[i];
                entries.push([`[${i}]`, {
                    kind: track.kind,
                    label: track.label,
                    language: track.language,
                    id: track.id,
                    enabled: track.enabled,
                    selected: track.selected
                }]);
            }
            entries.push(['length', value.length]);
        } else if (type === 'MediaError') {
            entries.push(['code', value.code]);
            entries.push(['message', value.message]);
            const errorCodes = {
                1: 'MEDIA_ERR_ABORTED',
                2: 'MEDIA_ERR_NETWORK', 
                3: 'MEDIA_ERR_DECODE',
                4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
            };
            entries.push(['meaning', errorCodes[value.code] || 'UNKNOWN']);
        } else if (type === 'array') {
            value.forEach((v, i) => entries.push([`[${i}]`, v]));
            entries.push(['length', value.length]);
        } else if (value instanceof HTMLVideoElement) {
            // Comprehensive video element properties
            const videoProps = [
                // Source
                'src', 'currentSrc', 'srcObject',
                // State
                'readyState', 'networkState', 'seeking', 'paused', 'ended', 'error',
                // Dimensions
                'videoWidth', 'videoHeight', 'width', 'height',
                // Time
                'currentTime', 'duration', 'played', 'seekable', 'buffered',
                // Playback
                'playbackRate', 'defaultPlaybackRate', 'preservesPitch',
                // Audio
                'volume', 'muted', 'defaultMuted',
                // Tracks
                'audioTracks', 'videoTracks', 'textTracks',
                // Settings
                'autoplay', 'loop', 'controls', 'preload', 'crossOrigin',
                'playsInline', 'poster', 'disablePictureInPicture', 'disableRemotePlayback',
                // Statistics (webkit)
                'webkitDecodedFrameCount', 'webkitDroppedFrameCount', 'webkitVideoDecodedByteCount', 'webkitAudioDecodedByteCount'
            ];
            
            videoProps.forEach(prop => {
                try {
                    const val = value[prop];
                    if (val !== undefined) {
                        entries.push([prop, val]);
                    }
                } catch (e) {
                    entries.push([prop, `[Error: ${e.message}]`]);
                }
            });
        } else {
            // Generic object
            const keys = Object.keys(value);
            keys.forEach(key => {
                try {
                    entries.push([key, value[key]]);
                } catch (e) {
                    entries.push([key, `[Error: ${e.message}]`]);
                }
            });
        }
    } catch (e) {
        entries.push(['[Error]', e.message]);
    }
    
    return entries;
}

function renderTreeNode(key, value, path = '', depth = 0) {
    if (depth > 10) return '<div class="tree-node"><span class="tree-null">[Max depth reached]</span></div>';
    
    const type = getType(value);
    const nodePath = path ? `${path}.${key}` : key;
    const expandable = isExpandable(value, type);
    const isExpanded = allExpanded || expandedNodes.has(nodePath);
    
    let html = '<div class="tree-node">';
    
    if (expandable) {
        html += `<div class="tree-expandable" data-path="${escapeHtml(nodePath)}">`;
        html += `<span class="tree-toggle">${isExpanded ? '▼' : '▶'}</span>`;
        html += `<span class="tree-key">${escapeHtml(key)}</span>: `;
        html += renderValue(value, type);
        html += `<span class="tree-type">${type}</span>`;
        html += '</div>';
        
        html += `<div class="tree-children ${isExpanded ? '' : 'collapsed'}">`;
        if (isExpanded) {
            const entries = getObjectEntries(value, type);
            entries.forEach(([childKey, childValue]) => {
                html += renderTreeNode(childKey, childValue, nodePath, depth + 1);
            });
        }
        html += '</div>';
    } else {
        html += `<span class="tree-toggle"></span>`;
        html += `<span class="tree-key">${escapeHtml(key)}</span>: `;
        html += renderValue(value, type);
        if (!['string', 'number', 'boolean', 'null', 'undefined'].includes(type)) {
            html += `<span class="tree-type">${type}</span>`;
        }
    }
    
    html += '</div>';
    return html;
}

function addTreeClickHandlers(container) {
    container.querySelectorAll('.tree-expandable').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const path = el.dataset.path;
            if (expandedNodes.has(path)) {
                expandedNodes.delete(path);
            } else {
                expandedNodes.add(path);
            }
            allExpanded = false;
            refreshAllTabs();
        });
    });
}

// ========================
// Tab Rendering
// ========================

function refreshStreamTab() {
    let html = '<div class="refresh-controls">';
    html += '<button class="btn btn-secondary btn-small" id="refreshStreamBtn">↻ Refresh</button>';
    html += '<button class="btn btn-secondary btn-small" id="expandAllStreamBtn">Expand All</button>';
    html += '</div>';
    
    // Stream Overview Cards
    html += '<div class="stream-info-grid">';
    
    // Resolution card
    html += '<div class="info-card">';
    html += '<div class="info-card-title">Resolution</div>';
    html += `<div class="info-card-value large">${video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : '-'}</div>`;
    html += '</div>';
    
    // Duration card
    html += '<div class="info-card">';
    html += '<div class="info-card-title">Duration</div>';
    html += `<div class="info-card-value large">${video.duration === Infinity ? 'LIVE' : (video.duration ? `${video.duration.toFixed(1)}s` : '-')}</div>`;
    html += '</div>';
    
    // Video Codec
    html += '<div class="info-card">';
    html += '<div class="info-card-title">Video Codec</div>';
    html += `<div class="info-card-value">${mediaInfo?.videoCodec || '-'}</div>`;
    html += '</div>';
    
    // Audio Codec
    html += '<div class="info-card">';
    html += '<div class="info-card-title">Audio Codec</div>';
    html += `<div class="info-card-value">${mediaInfo?.audioCodec || '-'}</div>`;
    html += '</div>';
    
    // Current Time
    html += '<div class="info-card">';
    html += '<div class="info-card-title">Current Time</div>';
    html += `<div class="info-card-value">${video.currentTime.toFixed(2)}s</div>`;
    html += '</div>';
    
    // Bitrate
    html += '<div class="info-card">';
    html += '<div class="info-card-title">Speed</div>';
    html += `<div class="info-card-value">${statisticsInfo?.speed ? `${(statisticsInfo.speed / 1024).toFixed(1)} KB/s` : '-'}</div>`;
    html += '</div>';
    
    html += '</div>'; // End grid
    
    // Tracks section
    if (mediaInfo) {
        html += '<div class="tree-section stream-info">Detected Tracks</div>';
        
        if (mediaInfo.videoCodec) {
            html += '<div class="track-item">';
            html += '<div class="track-item-header"><span class="track-type video">VIDEO</span></div>';
            html += `<div class="track-detail">Codec: ${mediaInfo.videoCodec}</div>`;
            if (mediaInfo.width) html += `<div class="track-detail">Size: ${mediaInfo.width}×${mediaInfo.height}</div>`;
            if (mediaInfo.fps) html += `<div class="track-detail">FPS: ${mediaInfo.fps}</div>`;
            if (mediaInfo.profile) html += `<div class="track-detail">Profile: ${mediaInfo.profile}</div>`;
            if (mediaInfo.level) html += `<div class="track-detail">Level: ${mediaInfo.level}</div>`;
            if (mediaInfo.chromaFormat) html += `<div class="track-detail">Chroma: ${mediaInfo.chromaFormat}</div>`;
            html += '</div>';
        }
        
        if (mediaInfo.audioCodec) {
            html += '<div class="track-item">';
            html += '<div class="track-item-header"><span class="track-type audio">AUDIO</span></div>';
            html += `<div class="track-detail">Codec: ${mediaInfo.audioCodec}</div>`;
            if (mediaInfo.audioSampleRate) html += `<div class="track-detail">Sample Rate: ${mediaInfo.audioSampleRate} Hz</div>`;
            if (mediaInfo.audioChannelCount) html += `<div class="track-detail">Channels: ${mediaInfo.audioChannelCount}</div>`;
            html += '</div>';
        }
    }
    
    // Buffer info
    if (video.buffered.length > 0) {
        html += '<div class="tree-section">Buffer Ranges</div>';
        for (let i = 0; i < video.buffered.length; i++) {
            html += '<div class="track-item">';
            html += `<div class="track-detail">Range ${i}: ${video.buffered.start(i).toFixed(2)}s - ${video.buffered.end(i).toFixed(2)}s</div>`;
            html += '</div>';
        }
    }
    
    streamTab.innerHTML = html;
    
    // Add refresh button handler
    document.getElementById('refreshStreamBtn')?.addEventListener('click', refreshStreamTab);
    document.getElementById('expandAllStreamBtn')?.addEventListener('click', () => {
        allExpanded = !allExpanded;
        refreshAllTabs();
    });
}

function refreshVideoTab() {
    let html = '<div class="refresh-controls">';
    html += '<button class="btn btn-secondary btn-small" id="refreshVideoBtn">↻ Refresh</button>';
    html += '<button class="btn btn-secondary btn-small" id="expandAllVideoBtn">Expand All</button>';
    html += '</div>';
    
    html += '<div class="tree-section">HTMLVideoElement</div>';
    html += renderTreeNode('video', video);
    
    videoTab.innerHTML = html;
    addTreeClickHandlers(videoTab);
    
    document.getElementById('refreshVideoBtn')?.addEventListener('click', refreshVideoTab);
    document.getElementById('expandAllVideoBtn')?.addEventListener('click', () => {
        allExpanded = !allExpanded;
        refreshAllTabs();
    });
}

function refreshMpegtsTab() {
    let html = '<div class="refresh-controls">';
    html += '<button class="btn btn-secondary btn-small" id="refreshMpegtsBtn">↻ Refresh</button>';
    html += '<button class="btn btn-secondary btn-small" id="expandAllMpegtsBtn">Expand All</button>';
    html += '</div>';
    
    // mpegts.js support status
    html += '<div class="tree-section">mpegts.js Status</div>';
    html += '<div class="track-item">';
    html += `<div class="track-detail">Supported: ${window.mpegts?.isSupported() ? 'Yes ✓' : 'No ✗'}</div>`;
    html += `<div class="track-detail">MSE Supported: ${window.mpegts?.getFeatureList()?.mseLivePlayback ? 'Yes' : 'No'}</div>`;
    html += `<div class="track-detail">Player Active: ${mpegtsPlayer ? 'Yes' : 'No'}</div>`;
    html += '</div>';
    
    // Media Info from mpegts.js
    if (mediaInfo) {
        html += '<div class="tree-section media-info">Media Info (from mpegts.js)</div>';
        html += renderTreeNode('mediaInfo', mediaInfo);
    } else {
        html += '<div class="tree-section media-info">Media Info</div>';
        html += '<div class="track-item"><div class="track-detail">No media info available yet. Play a stream to populate.</div></div>';
    }
    
    // Statistics Info
    if (statisticsInfo) {
        html += '<div class="tree-section">Statistics</div>';
        html += renderTreeNode('statisticsInfo', statisticsInfo);
    }
    
    // Feature list
    if (window.mpegts) {
        html += '<div class="tree-section">mpegts.js Features</div>';
        html += renderTreeNode('features', mpegts.getFeatureList());
    }
    
    mpegtsTab.innerHTML = html;
    addTreeClickHandlers(mpegtsTab);
    
    document.getElementById('refreshMpegtsBtn')?.addEventListener('click', refreshMpegtsTab);
    document.getElementById('expandAllMpegtsBtn')?.addEventListener('click', () => {
        allExpanded = !allExpanded;
        refreshAllTabs();
    });
}

function refreshAllTabs() {
    refreshStreamTab();
    refreshVideoTab();
    refreshMpegtsTab();
}

// ========================
// Tab Switching
// ========================

document.querySelectorAll('.inspector-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        // Update tab buttons
        document.querySelectorAll('.inspector-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const tabId = tab.dataset.tab + 'Tab';
        document.getElementById(tabId)?.classList.add('active');
    });
});

// ========================
// Playback Controls
// ========================

playBtn.addEventListener('click', () => {
    const url = streamUrlInput.value.trim();
    if (!url) {
        alert('Please enter a stream URL');
        return;
    }
    
    // Stop any existing playback
    stopPlayback();
    
    // Reset state
    mediaInfo = null;
    statisticsInfo = null;
    
    if (useMpegtsCheckbox.checked && window.mpegts && mpegts.isSupported()) {
        // Use mpegts.js
        logEvent('play', `Using mpegts.js: ${url}`, 'info');
        
        mpegtsPlayer = initMpegtsPlayer(url);
        if (mpegtsPlayer) {
            mpegtsPlayer.attachMediaElement(video);
            mpegtsPlayer.load();
            mpegtsPlayer.play();
        }
    } else {
        // Native playback
        logEvent('play', `Native playback: ${url}`, 'info');
        video.src = url;
        video.load();
        video.play().catch(err => {
            logEvent('play-error', err.message, 'error');
        });
    }
    
    refreshAllTabs();
});

stopBtn.addEventListener('click', () => {
    stopPlayback();
    logEvent('stop', 'Playback stopped', 'info');
    updateStatus();
    refreshAllTabs();
});

function stopPlayback() {
    if (mpegtsPlayer) {
        mpegtsPlayer.pause();
        mpegtsPlayer.unload();
        mpegtsPlayer.detachMediaElement();
        mpegtsPlayer.destroy();
        mpegtsPlayer = null;
    }
    
    video.pause();
    video.removeAttribute('src');
    video.load();
}

// ========================
// Discovery
// ========================

let discoveredDevices = [];

discoverBtn.addEventListener('click', () => {
    showDiscovery();
});

closeDiscoveryBtn.addEventListener('click', () => {
    discoveryOverlay.style.display = 'none';
});

connectManualBtn.addEventListener('click', async () => {
    const ip = manualIPInput.value.trim();
    if (!ip) {
        alert('Please enter an IP address');
        return;
    }
    
    try {
        const device = await discoverByIP(ip);
        if (device) {
            useDevice(device);
        } else {
            alert('No HDHomeRun device found at that IP');
        }
    } catch (err) {
        alert(`Error: ${err.message}`);
    }
});

async function showDiscovery() {
    discoveryOverlay.style.display = 'flex';
    discoveredDevices = [];
    
    discoveryContent.innerHTML = `
        <div class="discovery-status">
            <div class="discovery-spinner"></div>
            <p>Scanning network...</p>
        </div>
        <div class="discovery-devices" id="devicesList"></div>
    `;
    
    const devicesList = document.getElementById('devicesList');
    
    // Try to get subnet
    let subnet = '192.168.1';
    try {
        const detected = await detectLocalSubnet();
        if (detected) subnet = detected;
    } catch (e) {
        console.warn('Could not detect subnet');
    }
    
    // Try mDNS first
    try {
        const device = await discoverHDHR();
        if (device) {
            addDeviceToList(device, devicesList);
        }
    } catch (e) {
        console.log('mDNS/cloud discovery failed, scanning subnet...');
    }
    
    // Scan subnet
    try {
        await scanSubnet(subnet, (device) => {
            if (!discoveredDevices.find(d => d.DeviceID === device.DeviceID)) {
                addDeviceToList(device, devicesList);
            }
        });
    } catch (e) {
        console.warn('Subnet scan error:', e);
    }
    
    // Update status
    discoveryContent.querySelector('.discovery-status p').textContent = 
        discoveredDevices.length > 0 
            ? `Found ${discoveredDevices.length} device(s)` 
            : 'No devices found. Enter IP manually.';
    discoveryContent.querySelector('.discovery-spinner').style.display = 'none';
}

function addDeviceToList(device, container) {
    discoveredDevices.push(device);
    
    const div = document.createElement('div');
    div.className = 'discovery-device';
    div.innerHTML = `
        <div class="device-id">📺 ${device.DeviceID}</div>
        <div class="device-url">${device.BaseURL}</div>
    `;
    div.addEventListener('click', () => useDevice(device));
    container.appendChild(div);
}

function useDevice(device) {
    const match = device.BaseURL.match(/https?:\/\/([^:/]+)/);
    if (match) {
        const ip = match[1];
        streamUrlInput.value = `http://${ip}:5004/auto/v24`;
        logEvent('device-selected', device.DeviceID, 'success');
    }
    discoveryOverlay.style.display = 'none';
}

// ========================
// Keyboard / Remote Support
// ========================

const isWebOS = typeof window.webOS !== 'undefined' || 
                typeof window.webOSSystem !== 'undefined' ||
                navigator.userAgent.includes('Web0S') ||
                navigator.userAgent.includes('webOS');

if (isWebOS) {
    logEvent('platform', 'WebOS detected', 'info');
}

document.addEventListener('keydown', (e) => {
    if (e.keyCode === 461) e.key = 'Escape';
    
    if (discoveryOverlay.style.display === 'flex') {
        handleDiscoveryKeys(e);
        return;
    }
    
    switch (e.key) {
        case 'MediaPlayPause':
        case ' ':
            e.preventDefault();
            if (video.paused) video.play(); else video.pause();
            break;
        case 'MediaPlay':
            e.preventDefault();
            video.play();
            break;
        case 'MediaPause':
        case 'MediaStop':
            e.preventDefault();
            video.pause();
            break;
        case 'Escape':
        case 'Backspace':
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                if (!video.paused) video.pause();
            }
            break;
    }
});

function handleDiscoveryKeys(e) {
    const devices = Array.from(document.querySelectorAll('.discovery-device'));
    const currentDevice = devices.findIndex(d => d.classList.contains('focused'));
    
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            if (currentDevice > 0) {
                devices.forEach(d => d.classList.remove('focused'));
                devices[currentDevice - 1].classList.add('focused');
            }
            break;
        case 'ArrowDown':
            e.preventDefault();
            if (currentDevice < devices.length - 1) {
                devices.forEach(d => d.classList.remove('focused'));
                devices[currentDevice + 1].classList.add('focused');
            } else if (currentDevice === -1 && devices.length > 0) {
                devices[0].classList.add('focused');
            }
            break;
        case 'Enter':
            e.preventDefault();
            if (currentDevice >= 0) devices[currentDevice].click();
            else connectManualBtn.click();
            break;
        case 'Escape':
        case 'Backspace':
            e.preventDefault();
            discoveryOverlay.style.display = 'none';
            break;
    }
}

// ========================
// Initialize
// ========================

refreshAllTabs();
updateStatus();

// Periodic updates
setInterval(() => {
    updateStatus();
    // Only refresh stream tab frequently (for time updates)
    if (document.querySelector('[data-tab="stream"]').classList.contains('active')) {
        refreshStreamTab();
    }
}, 1000);

console.log('Stream Debugger initialized');
logEvent('init', `mpegts.js ${window.mpegts ? 'available' : 'not loaded'}`, window.mpegts ? 'success' : 'error');
