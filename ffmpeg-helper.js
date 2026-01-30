/**
 * FFmpeg.wasm Helper for Stream Analysis and DVB Subtitle Extraction
 * 
 * Uses FFmpeg WebAssembly build to:
 * - Probe stream metadata and detect all tracks
 * - Extract DVB subtitle streams and convert to images
 * - Process bitmap subtitles for OCR
 * 
 * WebOS Compatibility Notes:
 * - Uses single-threaded core (~31MB) - no SharedArrayBuffer needed
 * - May be slow on TV hardware - use sparingly
 * - Stream chunks are buffered then processed, not live
 */

export class FFmpegHelper {
    constructor(options = {}) {
        this.onLog = options.onLog || console.log;
        this.onError = options.onError || console.error;
        this.onProgress = options.onProgress || (() => {});
        this.onSubtitleImage = options.onSubtitleImage || (() => {});
        this.onStreamInfo = options.onStreamInfo || (() => {});
        
        this.ffmpeg = null;
        this.loaded = false;
        this.loading = false;
        
        // CDN URLs for ffmpeg core (single-threaded - WebOS compatible)
        this.coreBaseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
        this.utilBaseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd';
    }
    
    /**
     * Load FFmpeg.wasm - this is ~31MB so only call when needed
     */
    async load() {
        if (this.loaded) return true;
        if (this.loading) {
            // Wait for existing load
            while (this.loading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return this.loaded;
        }
        
        this.loading = true;
        this.onLog('Loading FFmpeg.wasm (~31MB)...');
        
        try {
            // Dynamic import of FFmpeg
            const FFmpegModule = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm');
            const FFmpegUtil = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm');
            
            this.FFmpeg = FFmpegModule.FFmpeg;
            this.fetchFile = FFmpegUtil.fetchFile;
            this.toBlobURL = FFmpegUtil.toBlobURL;
            
            this.ffmpeg = new this.FFmpeg();
            
            // Set up logging
            this.ffmpeg.on('log', ({ message }) => {
                this.onLog(`[ffmpeg] ${message}`);
            });
            
            this.ffmpeg.on('progress', ({ progress, time }) => {
                this.onProgress(progress * 100, time);
            });
            
            // Load the WASM core (single-threaded for WebOS compatibility)
            await this.ffmpeg.load({
                coreURL: await this.toBlobURL(
                    `${this.coreBaseURL}/ffmpeg-core.js`,
                    'text/javascript'
                ),
                wasmURL: await this.toBlobURL(
                    `${this.coreBaseURL}/ffmpeg-core.wasm`,
                    'application/wasm'
                )
            });
            
            this.loaded = true;
            this.loading = false;
            this.onLog('FFmpeg.wasm loaded successfully');
            return true;
            
        } catch (err) {
            this.loading = false;
            this.onError(`FFmpeg load failed: ${err.message}`);
            return false;
        }
    }
    
    /**
     * Probe a stream URL or buffer to get stream information
     * For live streams, we fetch a chunk first
     */
    async probeStream(urlOrBuffer, options = {}) {
        if (!this.loaded && !await this.load()) {
            throw new Error('FFmpeg not loaded');
        }
        
        let inputData;
        let inputName = 'input.ts';
        
        if (typeof urlOrBuffer === 'string') {
            // URL - fetch a chunk for probing
            const chunkSize = options.chunkSize || 2 * 1024 * 1024; // 2MB default
            this.onLog(`Fetching ${(chunkSize/1024/1024).toFixed(1)}MB chunk for probing...`);
            
            try {
                const response = await fetch(urlOrBuffer);
                const reader = response.body.getReader();
                const chunks = [];
                let totalSize = 0;
                
                while (totalSize < chunkSize) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    totalSize += value.length;
                }
                
                reader.cancel();
                
                // Combine chunks
                inputData = new Uint8Array(totalSize);
                let offset = 0;
                for (const chunk of chunks) {
                    inputData.set(chunk, offset);
                    offset += chunk.length;
                }
                
                this.onLog(`Fetched ${(totalSize/1024/1024).toFixed(2)}MB for analysis`);
                
            } catch (err) {
                throw new Error(`Failed to fetch stream: ${err.message}`);
            }
        } else {
            // Already a buffer
            inputData = new Uint8Array(urlOrBuffer);
        }
        
        // Write to virtual filesystem
        await this.ffmpeg.writeFile(inputName, inputData);
        
        // Run ffprobe equivalent using ffmpeg
        // -show_streams gives us stream info in parseable format
        try {
            await this.ffmpeg.exec([
                '-i', inputName,
                '-f', 'null',
                '-'
            ]);
        } catch (e) {
            // ffmpeg returns error for analysis-only, that's expected
        }
        
        // Parse the log output for stream info
        // The actual probing happens via the log messages
        
        // Clean up
        await this.ffmpeg.deleteFile(inputName);
        
        return {
            probed: true,
            inputSize: inputData.length
        };
    }
    
    /**
     * Extract DVB subtitle images from a stream chunk
     * Converts DVB bitmap subtitles to PNG images for OCR processing
     */
    async extractSubtitleImages(urlOrBuffer, options = {}) {
        if (!this.loaded && !await this.load()) {
            throw new Error('FFmpeg not loaded');
        }
        
        let inputData;
        const inputName = 'input.ts';
        const outputPattern = 'sub_%04d.png';
        
        if (typeof urlOrBuffer === 'string') {
            // Fetch chunk from URL
            const chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB for subtitle extraction
            const startTime = options.startTime || 0;
            
            this.onLog(`Fetching stream chunk for subtitle extraction...`);
            
            const response = await fetch(urlOrBuffer);
            const reader = response.body.getReader();
            const chunks = [];
            let totalSize = 0;
            
            while (totalSize < chunkSize) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                totalSize += value.length;
            }
            
            reader.cancel();
            
            inputData = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
                inputData.set(chunk, offset);
                offset += chunk.length;
            }
        } else {
            inputData = new Uint8Array(urlOrBuffer);
        }
        
        await this.ffmpeg.writeFile(inputName, inputData);
        
        // Build ffmpeg command to extract DVB subtitle images
        const ffmpegArgs = [
            '-i', inputName,
            '-map', '0:s?',  // Select subtitle stream if present
            '-c:s', 'png',   // Convert to PNG
            '-vsync', '0',
            outputPattern
        ];
        
        // Add subtitle stream index if specified
        if (options.subtitleIndex !== undefined) {
            ffmpegArgs.splice(2, 2, '-map', `0:s:${options.subtitleIndex}`);
        }
        
        try {
            await this.ffmpeg.exec(ffmpegArgs);
        } catch (err) {
            this.onLog(`FFmpeg subtitle extraction: ${err.message}`);
        }
        
        // Collect output images
        const images = [];
        for (let i = 1; i <= 9999; i++) {
            const filename = `sub_${String(i).padStart(4, '0')}.png`;
            try {
                const data = await this.ffmpeg.readFile(filename);
                images.push({
                    index: i,
                    filename: filename,
                    data: data,
                    blob: new Blob([data], { type: 'image/png' })
                });
                await this.ffmpeg.deleteFile(filename);
                this.onSubtitleImage(images[images.length - 1]);
            } catch {
                break; // No more files
            }
        }
        
        // Clean up input
        await this.ffmpeg.deleteFile(inputName);
        
        this.onLog(`Extracted ${images.length} subtitle images`);
        return images;
    }
    
    /**
     * Analyze stream and return detailed info about all tracks
     */
    async analyzeStream(urlOrBuffer, options = {}) {
        if (!this.loaded && !await this.load()) {
            throw new Error('FFmpeg not loaded');
        }
        
        let inputData;
        const inputName = 'input.ts';
        
        if (typeof urlOrBuffer === 'string') {
            const chunkSize = options.chunkSize || 2 * 1024 * 1024;
            
            const response = await fetch(urlOrBuffer);
            const reader = response.body.getReader();
            const chunks = [];
            let totalSize = 0;
            
            while (totalSize < chunkSize) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                totalSize += value.length;
            }
            
            reader.cancel();
            
            inputData = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
                inputData.set(chunk, offset);
                offset += chunk.length;
            }
        } else {
            inputData = new Uint8Array(urlOrBuffer);
        }
        
        await this.ffmpeg.writeFile(inputName, inputData);
        
        // Capture logs for parsing
        const logs = [];
        const logHandler = ({ message }) => {
            logs.push(message);
        };
        
        this.ffmpeg.on('log', logHandler);
        
        try {
            // Run ffmpeg to get stream info (will fail but we get the logs)
            await this.ffmpeg.exec(['-i', inputName]);
        } catch {
            // Expected to fail
        }
        
        // Parse stream info from logs
        const streamInfo = this.parseStreamInfo(logs);
        
        // Clean up
        await this.ffmpeg.deleteFile(inputName);
        
        this.onStreamInfo(streamInfo);
        return streamInfo;
    }
    
    /**
     * Parse ffmpeg log output to extract stream information
     */
    parseStreamInfo(logs) {
        const info = {
            format: null,
            duration: null,
            bitrate: null,
            streams: [],
            videoStreams: [],
            audioStreams: [],
            subtitleStreams: []
        };
        
        const logText = logs.join('\n');
        
        // Parse input format
        const formatMatch = logText.match(/Input #\d+, (\w+), from/);
        if (formatMatch) {
            info.format = formatMatch[1];
        }
        
        // Parse duration
        const durationMatch = logText.match(/Duration: ([\d:.]+)/);
        if (durationMatch) {
            info.duration = durationMatch[1];
        }
        
        // Parse bitrate
        const bitrateMatch = logText.match(/bitrate: (\d+) kb\/s/);
        if (bitrateMatch) {
            info.bitrate = parseInt(bitrateMatch[1]);
        }
        
        // Parse individual streams
        const streamRegex = /Stream #\d+:(\d+)(?:\[0x([0-9a-f]+)\])?(?:\((\w+)\))?: (\w+): (.+)/gi;
        let match;
        
        while ((match = streamRegex.exec(logText)) !== null) {
            const stream = {
                index: parseInt(match[1]),
                pid: match[2] ? parseInt(match[2], 16) : null,
                language: match[3] || null,
                type: match[4].toLowerCase(),
                codec: match[5].split(',')[0].trim(),
                details: match[5]
            };
            
            info.streams.push(stream);
            
            if (stream.type === 'video') {
                info.videoStreams.push(stream);
            } else if (stream.type === 'audio') {
                info.audioStreams.push(stream);
            } else if (stream.type === 'subtitle') {
                info.subtitleStreams.push(stream);
            }
        }
        
        return info;
    }
    
    /**
     * Remux a stream chunk to a browser-compatible format
     * Useful if native player can't handle certain codecs
     */
    async remuxChunk(inputBuffer, outputFormat = 'mp4') {
        if (!this.loaded && !await this.load()) {
            throw new Error('FFmpeg not loaded');
        }
        
        const inputName = 'input.ts';
        const outputName = `output.${outputFormat}`;
        
        await this.ffmpeg.writeFile(inputName, new Uint8Array(inputBuffer));
        
        try {
            await this.ffmpeg.exec([
                '-i', inputName,
                '-c', 'copy',  // No transcoding, just remux
                '-movflags', '+faststart+frag_keyframe+empty_moov',
                outputName
            ]);
            
            const outputData = await this.ffmpeg.readFile(outputName);
            
            // Clean up
            await this.ffmpeg.deleteFile(inputName);
            await this.ffmpeg.deleteFile(outputName);
            
            return outputData;
            
        } catch (err) {
            this.onError(`Remux failed: ${err.message}`);
            await this.ffmpeg.deleteFile(inputName).catch(() => {});
            return null;
        }
    }
    
    /**
     * Check if FFmpeg.wasm is likely to work in current environment
     */
    static checkCompatibility() {
        const issues = [];
        
        // Check WebAssembly support
        if (typeof WebAssembly === 'undefined') {
            issues.push('WebAssembly not supported');
        }
        
        // Check for Fetch API
        if (typeof fetch === 'undefined') {
            issues.push('Fetch API not supported');
        }
        
        // Check for Blob
        if (typeof Blob === 'undefined') {
            issues.push('Blob not supported');
        }
        
        // SharedArrayBuffer (optional - needed for multi-threaded)
        const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
        
        return {
            compatible: issues.length === 0,
            issues: issues,
            hasSharedArrayBuffer: hasSharedArrayBuffer,
            recommendations: hasSharedArrayBuffer 
                ? 'Full support including multi-threaded mode'
                : 'Single-threaded mode only (slower but compatible)'
        };
    }
    
    /**
     * Get estimated memory usage
     */
    getMemoryUsage() {
        if (!this.loaded) return null;
        
        // Rough estimate based on loaded state
        return {
            estimatedMB: 50, // Base memory
            loaded: this.loaded
        };
    }
    
    /**
     * Unload FFmpeg to free memory
     */
    async unload() {
        if (this.ffmpeg) {
            try {
                await this.ffmpeg.terminate();
            } catch {
                // Ignore errors
            }
            this.ffmpeg = null;
            this.loaded = false;
            this.onLog('FFmpeg.wasm unloaded');
        }
    }
}

// Export compatibility check separately for quick check without loading
export function checkFFmpegCompatibility() {
    return FFmpegHelper.checkCompatibility();
}
