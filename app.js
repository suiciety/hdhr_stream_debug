// Stream Debugger - Main Application

import { discoverHDHR, discoverByIP, scanSubnet, detectLocalSubnet } from './discovery.js';

const video = document.getElementById('videoPlayer');
const streamUrlInput = document.getElementById('streamUrl');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const discoverBtn = document.getElementById('discoverBtn');
const treeView = document.getElementById('treeView');
const eventsLog = document.getElementById('eventsLog');
const refreshTreeBtn = document.getElementById('refreshTreeBtn');
const expandAllBtn = document.getElementById('expandAllBtn');

// Status elements
const statusState = document.getElementById('statusState');
const statusReady = document.getElementById('statusReady');
const statusResolution = document.getElementById('statusResolution');
const statusDuration = document.getElementById('statusDuration');
const statusBuffered = document.getElementById('statusBuffered');

// Discovery elements
const discoveryOverlay = document.getElementById('discoveryOverlay');
const discoveryContent = document.getElementById('discoveryContent');
const manualIPInput = document.getElementById('manualIP');
const connectManualBtn = document.getElementById('connectManualBtn');
const closeDiscoveryBtn = document.getElementById('closeDiscoveryBtn');

let expandedNodes = new Set();
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

function logEvent(eventName, detail = '') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-name">${eventName}</span>
        ${detail ? `<span class="event-detail">${detail}</span>` : ''}
    `;
    eventsLog.insertBefore(item, eventsLog.firstChild);
    
    // Keep only last 100 events
    while (eventsLog.children.length > 100) {
        eventsLog.removeChild(eventsLog.lastChild);
    }
}

videoEvents.forEach(eventName => {
    video.addEventListener(eventName, (e) => {
        let detail = '';
        
        if (eventName === 'error' && video.error) {
            detail = `code: ${video.error.code}, message: ${video.error.message || 'unknown'}`;
        } else if (eventName === 'loadedmetadata') {
            detail = `${video.videoWidth}x${video.videoHeight}`;
        } else if (eventName === 'durationchange') {
            detail = `${video.duration}s`;
        } else if (eventName === 'progress' && video.buffered.length > 0) {
            detail = `buffered: ${video.buffered.end(video.buffered.length - 1).toFixed(1)}s`;
        }
        
        logEvent(eventName, detail);
        updateStatus();
        refreshTree();
    });
});

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
    
    // Ready State
    const readyStates = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
    statusReady.textContent = `${video.readyState} (${readyStates[video.readyState] || 'unknown'})`;
    
    // Resolution
    if (video.videoWidth && video.videoHeight) {
        statusResolution.textContent = `${video.videoWidth}x${video.videoHeight}`;
    } else {
        statusResolution.textContent = '-';
    }
    
    // Duration
    if (video.duration && isFinite(video.duration)) {
        statusDuration.textContent = `${video.duration.toFixed(2)}s`;
    } else if (video.duration === Infinity) {
        statusDuration.textContent = 'LIVE';
    } else {
        statusDuration.textContent = '-';
    }
    
    // Buffered
    if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferedAhead = bufferedEnd - video.currentTime;
        statusBuffered.textContent = `${bufferedAhead.toFixed(1)}s ahead`;
    } else {
        statusBuffered.textContent = '-';
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
    return typeof value;
}

function getPreview(value, type) {
    switch (type) {
        case 'string':
            return `"${value.length > 50 ? value.substring(0, 50) + '...' : value}"`;
        case 'number':
            return String(value);
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
            return `MediaError(code: ${value.code})`;
        case 'element':
            return `<${value.tagName.toLowerCase()}>`;
        case 'object':
            const keys = Object.keys(value);
            return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
        default:
            return String(value);
    }
}

function isExpandable(value, type) {
    return ['object', 'array', 'TimeRanges', 'TextTrackList', 'AudioTrackList', 'VideoTrackList', 'MediaError'].includes(type) 
           && value !== null;
}

function renderValue(value, type) {
    switch (type) {
        case 'string':
            return `<span class="tree-string">"${escapeHtml(value)}"</span>`;
        case 'number':
            return `<span class="tree-number">${value}</span>`;
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
    
    if (type === 'TimeRanges') {
        for (let i = 0; i < value.length; i++) {
            entries.push([`[${i}]`, { start: value.start(i), end: value.end(i) }]);
        }
        entries.push(['length', value.length]);
    } else if (type === 'TextTrackList' || type === 'AudioTrackList' || type === 'VideoTrackList') {
        for (let i = 0; i < value.length; i++) {
            entries.push([`[${i}]`, value[i]]);
        }
        entries.push(['length', value.length]);
    } else if (type === 'MediaError') {
        entries.push(['code', value.code]);
        entries.push(['message', value.message]);
        entries.push(['MEDIA_ERR_ABORTED', 1]);
        entries.push(['MEDIA_ERR_NETWORK', 2]);
        entries.push(['MEDIA_ERR_DECODE', 3]);
        entries.push(['MEDIA_ERR_SRC_NOT_SUPPORTED', 4]);
    } else if (type === 'array') {
        value.forEach((v, i) => entries.push([`[${i}]`, v]));
        entries.push(['length', value.length]);
    } else {
        // Get own properties and some prototype properties
        const seen = new Set();
        
        // Own properties first
        Object.keys(value).forEach(key => {
            if (!seen.has(key)) {
                seen.add(key);
                try {
                    entries.push([key, value[key]]);
                } catch (e) {
                    entries.push([key, `[Error: ${e.message}]`]);
                }
            }
        });
        
        // Important video element properties
        if (value instanceof HTMLVideoElement) {
            const videoProps = [
                'src', 'currentSrc', 'crossOrigin', 'networkState', 'readyState',
                'seeking', 'currentTime', 'duration', 'paused', 'ended', 'autoplay',
                'loop', 'controls', 'volume', 'muted', 'defaultMuted', 'playbackRate',
                'defaultPlaybackRate', 'played', 'seekable', 'buffered', 'error',
                'videoWidth', 'videoHeight', 'poster', 'playsInline', 'webkitDecodedFrameCount',
                'webkitDroppedFrameCount', 'audioTracks', 'videoTracks', 'textTracks',
                'width', 'height', 'preload', 'srcObject', 'disablePictureInPicture',
                'disableRemotePlayback', 'preservesPitch'
            ];
            
            videoProps.forEach(prop => {
                if (!seen.has(prop)) {
                    seen.add(prop);
                    try {
                        entries.push([prop, value[prop]]);
                    } catch (e) {
                        entries.push([prop, `[Error: ${e.message}]`]);
                    }
                }
            });
        }
    }
    
    return entries;
}

function renderTreeNode(key, value, path = '') {
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
                html += renderTreeNode(childKey, childValue, nodePath);
            });
        }
        html += '</div>';
    } else {
        html += `<span class="tree-toggle"></span>`;
        html += `<span class="tree-key">${escapeHtml(key)}</span>: `;
        html += renderValue(value, type);
        if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'null' && type !== 'undefined') {
            html += `<span class="tree-type">${type}</span>`;
        }
    }
    
    html += '</div>';
    return html;
}

function refreshTree() {
    const html = renderTreeNode('video', video);
    treeView.innerHTML = html;
    
    // Add click handlers for expandable nodes
    treeView.querySelectorAll('.tree-expandable').forEach(el => {
        el.addEventListener('click', (e) => {
            const path = el.dataset.path;
            if (expandedNodes.has(path)) {
                expandedNodes.delete(path);
            } else {
                expandedNodes.add(path);
            }
            allExpanded = false;
            refreshTree();
        });
    });
}

// ========================
// Controls
// ========================

playBtn.addEventListener('click', () => {
    const url = streamUrlInput.value.trim();
    if (!url) {
        alert('Please enter a stream URL');
        return;
    }
    
    video.src = url;
    video.load();
    video.play().catch(err => {
        logEvent('play-error', err.message);
    });
    
    logEvent('manual-play', url);
});

stopBtn.addEventListener('click', () => {
    video.pause();
    video.src = '';
    video.load();
    logEvent('manual-stop');
    updateStatus();
    refreshTree();
});

refreshTreeBtn.addEventListener('click', () => {
    refreshTree();
});

expandAllBtn.addEventListener('click', () => {
    allExpanded = !allExpanded;
    expandAllBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';
    refreshTree();
});

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
            // Check if already in list
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
    // Extract IP from BaseURL
    const match = device.BaseURL.match(/https?:\/\/([^:/]+)/);
    if (match) {
        const ip = match[1];
        // Set default channel URL
        streamUrlInput.value = `http://${ip}:5004/auto/v24`;
        logEvent('device-selected', device.DeviceID);
    }
    discoveryOverlay.style.display = 'none';
}

// ========================
// WebOS / TV Remote Support
// ========================

const isWebOS = typeof window.webOS !== 'undefined' || 
                typeof window.webOSSystem !== 'undefined' ||
                navigator.userAgent.includes('Web0S') ||
                navigator.userAgent.includes('webOS');

if (isWebOS) {
    logEvent('platform', 'WebOS detected');
}

// Focusable elements for TV navigation
let focusableElements = [];
let currentFocusIndex = 0;

function updateFocusableElements() {
    focusableElements = Array.from(document.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), .tree-expandable, .discovery-device'
    )).filter(el => {
        // Only include visible elements
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });
}

function setFocus(index) {
    // Remove previous focus
    focusableElements.forEach(el => el.classList.remove('tv-focused'));
    
    // Set new focus
    currentFocusIndex = Math.max(0, Math.min(index, focusableElements.length - 1));
    if (focusableElements[currentFocusIndex]) {
        focusableElements[currentFocusIndex].classList.add('tv-focused');
        focusableElements[currentFocusIndex].scrollIntoView({ block: 'nearest' });
        
        // Focus input elements for text entry
        if (focusableElements[currentFocusIndex].tagName === 'INPUT') {
            focusableElements[currentFocusIndex].focus();
        }
    }
}

document.addEventListener('keydown', (e) => {
    // Map webOS back button
    if (e.keyCode === 461) {
        e.key = 'Escape';
    }
    
    // Handle discovery overlay separately
    if (discoveryOverlay.style.display === 'flex') {
        handleDiscoveryKeys(e);
        return;
    }
    
    updateFocusableElements();
    
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            setFocus(currentFocusIndex - 1);
            break;
        case 'ArrowDown':
            e.preventDefault();
            setFocus(currentFocusIndex + 1);
            break;
        case 'ArrowLeft':
            e.preventDefault();
            // Find element to the left
            if (focusableElements[currentFocusIndex]) {
                const current = focusableElements[currentFocusIndex].getBoundingClientRect();
                let bestIndex = currentFocusIndex;
                let bestDist = Infinity;
                focusableElements.forEach((el, i) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.right < current.left) {
                        const dist = current.left - rect.right;
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestIndex = i;
                        }
                    }
                });
                setFocus(bestIndex);
            }
            break;
        case 'ArrowRight':
            e.preventDefault();
            // Find element to the right
            if (focusableElements[currentFocusIndex]) {
                const current = focusableElements[currentFocusIndex].getBoundingClientRect();
                let bestIndex = currentFocusIndex;
                let bestDist = Infinity;
                focusableElements.forEach((el, i) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.left > current.right) {
                        const dist = rect.left - current.right;
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestIndex = i;
                        }
                    }
                });
                setFocus(bestIndex);
            }
            break;
        case 'Enter':
            e.preventDefault();
            if (focusableElements[currentFocusIndex]) {
                focusableElements[currentFocusIndex].click();
            }
            break;
        case 'Escape':
        case 'Backspace':
            // Go back or stop video
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                if (!video.paused) {
                    video.pause();
                    logEvent('remote', 'Back pressed - paused');
                }
            }
            break;
        case 'MediaPlayPause':
        case ' ':
            e.preventDefault();
            if (video.paused) {
                video.play();
            } else {
                video.pause();
            }
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
            if (currentDevice >= 0) {
                devices[currentDevice].click();
            } else {
                // Try manual connect
                connectManualBtn.click();
            }
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

// Initial tree render
refreshTree();
updateStatus();

// Periodic status update
setInterval(updateStatus, 1000);

// Initial focus setup
setTimeout(() => {
    updateFocusableElements();
    setFocus(0);
}, 100);

console.log('Stream Debugger initialized');
logEvent('init', 'Stream debugger ready');
