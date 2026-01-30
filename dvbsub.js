/**
 * DVB-SUB Bitmap Subtitle Decoder with Tesseract.js OCR
 * 
 * Handles DVB subtitle streams (ETSI EN 300 743) commonly found in
 * European DVB broadcasts. Extracts bitmap images and converts to text via OCR.
 * 
 * DVB-SUB Format Overview:
 * - Subtitles are transmitted as bitmap images, not text
 * - Each subtitle has: page_id, region definitions, CLUT (color table), pixel data
 * - Pixels use run-length encoding (RLE) with 2/4/8-bit color depth
 * - Subtitles have display timing (PTS) for synchronization
 */

export class DVBSubDecoder {
    constructor(options = {}) {
        this.onSubtitle = options.onSubtitle || (() => {});
        this.onBitmap = options.onBitmap || (() => {});
        this.onOCRResult = options.onOCRResult || (() => {});
        this.onError = options.onError || console.error;
        this.onLog = options.onLog || console.log;
        
        // OCR settings
        this.ocrLanguage = options.language || 'eng';
        this.ocrEnabled = options.ocrEnabled !== false;
        this.displayMode = options.displayMode || 'ocr'; // 'bitmap', 'ocr', 'both'
        
        // State
        this.tesseractWorker = null;
        this.tesseractReady = false;
        this.tesseractLoading = false;
        this.ocrQueue = [];
        this.processing = false;
        
        // DVB-SUB state
        this.pages = new Map();
        this.regions = new Map();
        this.cluts = new Map();
        this.objects = new Map();
        
        // Statistics
        this.stats = {
            bitmapsDecoded: 0,
            ocrProcessed: 0,
            errors: 0
        };
        
        // Default CLUT (2-bit)
        this.defaultClut = [
            { r: 0, g: 0, b: 0, a: 0 },      // Transparent
            { r: 255, g: 255, b: 255, a: 255 }, // White
            { r: 0, g: 0, b: 0, a: 255 },       // Black
            { r: 128, g: 128, b: 128, a: 255 }  // Gray
        ];
    }
    
    /**
     * Initialize Tesseract.js worker
     */
    async initTesseract() {
        if (this.tesseractReady || this.tesseractLoading) return;
        
        this.tesseractLoading = true;
        this.onLog('Initializing Tesseract.js...');
        
        try {
            if (typeof Tesseract === 'undefined') {
                throw new Error('Tesseract.js not loaded');
            }
            
            this.tesseractWorker = await Tesseract.createWorker(this.ocrLanguage, 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        // Progress update - don't spam logs
                    }
                }
            });
            
            this.tesseractReady = true;
            this.tesseractLoading = false;
            this.onLog(`Tesseract.js ready (${this.ocrLanguage})`);
            
            // Process queued items
            this.processOCRQueue();
            
        } catch (err) {
            this.tesseractLoading = false;
            this.onError('Tesseract init failed: ' + err.message);
        }
    }
    
    /**
     * Change OCR language
     */
    async setLanguage(lang) {
        this.ocrLanguage = lang;
        
        if (this.tesseractWorker) {
            try {
                await this.tesseractWorker.reinitialize(lang);
                this.onLog(`OCR language changed to: ${lang}`);
            } catch (err) {
                this.onError('Language change failed: ' + err.message);
            }
        }
    }
    
    /**
     * Decode DVB-SUB PES packet data
     * @param {Uint8Array} data - PES packet payload
     * @param {number} pts - Presentation timestamp (90kHz)
     */
    decode(data, pts) {
        if (!data || data.length < 2) return;
        
        try {
            let offset = 0;
            
            // DVB subtitle segment header
            // data_identifier (0x20 for DVB subtitles)
            // subtitle_stream_id (usually 0x00)
            
            if (data[0] === 0x20 || data[0] === 0x00) {
                offset = 2; // Skip identifier bytes
            }
            
            while (offset < data.length - 6) {
                // Segment sync byte
                if (data[offset] !== 0x0F) {
                    offset++;
                    continue;
                }
                
                const segmentType = data[offset + 1];
                const pageId = (data[offset + 2] << 8) | data[offset + 3];
                const segmentLength = (data[offset + 4] << 8) | data[offset + 5];
                
                offset += 6;
                
                if (offset + segmentLength > data.length) break;
                
                const segmentData = data.slice(offset, offset + segmentLength);
                
                switch (segmentType) {
                    case 0x10: // Page composition segment
                        this.parsePageComposition(pageId, segmentData, pts);
                        break;
                    case 0x11: // Region composition segment
                        this.parseRegionComposition(pageId, segmentData);
                        break;
                    case 0x12: // CLUT definition segment
                        this.parseCLUTDefinition(pageId, segmentData);
                        break;
                    case 0x13: // Object data segment
                        this.parseObjectData(pageId, segmentData);
                        break;
                    case 0x14: // Display definition segment
                        this.parseDisplayDefinition(segmentData);
                        break;
                    case 0x80: // End of display set
                        this.renderPage(pageId, pts);
                        break;
                }
                
                offset += segmentLength;
            }
            
        } catch (err) {
            this.stats.errors++;
            this.onError('DVB-SUB decode error: ' + err.message);
        }
    }
    
    parsePageComposition(pageId, data, pts) {
        if (data.length < 2) return;
        
        const pageTimeout = data[0];
        const pageVersionFlags = data[1];
        const pageState = (pageVersionFlags >> 2) & 0x03;
        
        const page = {
            id: pageId,
            timeout: pageTimeout,
            state: pageState,
            pts: pts,
            regions: []
        };
        
        let offset = 2;
        while (offset < data.length - 5) {
            const regionId = data[offset];
            const regionX = (data[offset + 2] << 8) | data[offset + 3];
            const regionY = (data[offset + 4] << 8) | data[offset + 5];
            
            page.regions.push({ id: regionId, x: regionX, y: regionY });
            offset += 6;
        }
        
        this.pages.set(pageId, page);
    }
    
    parseRegionComposition(pageId, data) {
        if (data.length < 10) return;
        
        const regionId = data[0];
        const versionFlags = data[1];
        const fillFlag = (versionFlags >> 3) & 0x01;
        
        const width = (data[2] << 8) | data[3];
        const height = (data[4] << 8) | data[5];
        const levelOfCompatibility = (data[6] >> 5) & 0x07;
        const depth = (data[6] >> 2) & 0x07;
        const clutId = data[7];
        const bgPixelCode = data[9];
        
        const region = {
            id: regionId,
            width: width,
            height: height,
            depth: depth,
            clutId: clutId,
            bgPixel: bgPixelCode,
            objects: []
        };
        
        let offset = 10;
        while (offset < data.length - 5) {
            const objectId = (data[offset] << 8) | data[offset + 1];
            const objectType = (data[offset + 2] >> 6) & 0x03;
            const objectProviderFlag = (data[offset + 2] >> 4) & 0x03;
            const objectX = ((data[offset + 2] & 0x0F) << 8) | data[offset + 3];
            const objectY = ((data[offset + 4] & 0x0F) << 8) | data[offset + 5];
            
            region.objects.push({
                id: objectId,
                type: objectType,
                x: objectX,
                y: objectY
            });
            
            offset += 6;
            if (objectType === 0x01 || objectType === 0x02) {
                offset += 2; // Skip foreground/background pixel codes
            }
        }
        
        this.regions.set(regionId, region);
    }
    
    parseCLUTDefinition(pageId, data) {
        if (data.length < 2) return;
        
        const clutId = data[0];
        const versionFlag = data[1];
        
        const clut = new Array(256).fill(null).map(() => ({ r: 0, g: 0, b: 0, a: 0 }));
        
        // Copy default CLUT
        for (let i = 0; i < this.defaultClut.length; i++) {
            clut[i] = { ...this.defaultClut[i] };
        }
        
        let offset = 2;
        while (offset < data.length) {
            const clutEntryId = data[offset];
            const flags = data[offset + 1];
            
            const is2bit = (flags >> 7) & 0x01;
            const is4bit = (flags >> 6) & 0x01;
            const is8bit = (flags >> 5) & 0x01;
            const fullRange = (flags >> 0) & 0x01;
            
            offset += 2;
            
            let y, cr, cb, t;
            
            if (fullRange) {
                y = data[offset++];
                cr = data[offset++];
                cb = data[offset++];
                t = data[offset++];
            } else {
                const ycrCb = (data[offset] << 8) | data[offset + 1];
                y = (ycrCb >> 10) & 0x3F;
                cr = (ycrCb >> 6) & 0x0F;
                cb = (ycrCb >> 2) & 0x0F;
                t = ycrCb & 0x03;
                offset += 2;
            }
            
            // YCrCb to RGB conversion
            const r = Math.max(0, Math.min(255, y + 1.402 * (cr - 128)));
            const g = Math.max(0, Math.min(255, y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)));
            const b = Math.max(0, Math.min(255, y + 1.772 * (cb - 128)));
            const a = 255 - t;
            
            clut[clutEntryId] = { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
        }
        
        this.cluts.set(clutId, clut);
    }
    
    parseObjectData(pageId, data) {
        if (data.length < 3) return;
        
        const objectId = (data[0] << 8) | data[1];
        const versionFlags = data[2];
        const codingMethod = (versionFlags >> 2) & 0x03;
        const nonModifyingColourFlag = (versionFlags >> 1) & 0x01;
        
        const object = {
            id: objectId,
            codingMethod: codingMethod,
            topFieldData: null,
            bottomFieldData: null
        };
        
        if (codingMethod === 0x00) {
            // Pixel coding
            const topFieldLength = (data[3] << 8) | data[4];
            const bottomFieldLength = (data[5] << 8) | data[6];
            
            object.topFieldData = data.slice(7, 7 + topFieldLength);
            object.bottomFieldData = data.slice(7 + topFieldLength, 7 + topFieldLength + bottomFieldLength);
        }
        
        this.objects.set(objectId, object);
    }
    
    parseDisplayDefinition(data) {
        // Display definition - defines the display resolution
        // Not strictly required for basic rendering
    }
    
    /**
     * Render page to bitmap and process OCR
     */
    renderPage(pageId, pts) {
        const page = this.pages.get(pageId);
        if (!page || page.regions.length === 0) return;
        
        // Calculate overall dimensions
        let maxWidth = 720;
        let maxHeight = 576;
        
        // Create canvas for rendering
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');
        
        // Clear with transparency
        ctx.clearRect(0, 0, maxWidth, maxHeight);
        
        let hasContent = false;
        
        for (const pageRegion of page.regions) {
            const region = this.regions.get(pageRegion.id);
            if (!region) continue;
            
            const clut = this.cluts.get(region.clutId) || this.defaultClut;
            
            for (const regObject of region.objects) {
                const object = this.objects.get(regObject.id);
                if (!object || !object.topFieldData) continue;
                
                // Decode RLE pixel data
                const pixels = this.decodePixelData(object, region, clut);
                if (pixels) {
                    hasContent = true;
                    
                    // Create ImageData
                    const imageData = ctx.createImageData(region.width, region.height);
                    
                    for (let i = 0; i < pixels.length; i++) {
                        const color = pixels[i];
                        imageData.data[i * 4] = color.r;
                        imageData.data[i * 4 + 1] = color.g;
                        imageData.data[i * 4 + 2] = color.b;
                        imageData.data[i * 4 + 3] = color.a;
                    }
                    
                    // Draw to canvas
                    const x = pageRegion.x + regObject.x;
                    const y = pageRegion.y + regObject.y;
                    
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = region.width;
                    tempCanvas.height = region.height;
                    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
                    
                    ctx.drawImage(tempCanvas, x, y);
                }
            }
        }
        
        if (!hasContent) return;
        
        this.stats.bitmapsDecoded++;
        
        // Trim canvas to content
        const trimmed = this.trimCanvas(canvas);
        
        // Emit bitmap event
        this.onBitmap({
            canvas: trimmed.canvas,
            pts: pts,
            time: pts / 90000,
            width: trimmed.canvas.width,
            height: trimmed.canvas.height
        });
        
        // Queue for OCR if enabled
        if (this.ocrEnabled && (this.displayMode === 'ocr' || this.displayMode === 'both')) {
            this.queueOCR(trimmed.canvas, pts);
        }
    }
    
    /**
     * Decode RLE pixel data
     */
    decodePixelData(object, region, clut) {
        const width = region.width;
        const height = region.height;
        const depth = region.depth;
        
        const pixels = new Array(width * height).fill(clut[region.bgPixel] || { r: 0, g: 0, b: 0, a: 0 });
        
        // Decode top field (even lines)
        if (object.topFieldData) {
            this.decodeField(object.topFieldData, pixels, width, height, 0, depth, clut);
        }
        
        // Decode bottom field (odd lines)
        if (object.bottomFieldData && object.bottomFieldData.length > 0) {
            this.decodeField(object.bottomFieldData, pixels, width, height, 1, depth, clut);
        } else if (object.topFieldData) {
            // Copy top field to bottom
            this.decodeField(object.topFieldData, pixels, width, height, 1, depth, clut);
        }
        
        return pixels;
    }
    
    decodeField(data, pixels, width, height, fieldOffset, depth, clut) {
        let offset = 0;
        let x = 0;
        let y = fieldOffset;
        
        while (offset < data.length && y < height) {
            const byte = data[offset++];
            
            if (byte === 0x00) {
                // Next line
                x = 0;
                y += 2;
                continue;
            }
            
            // 2-bit pixel decoding (simplified)
            let color = clut[byte] || clut[0];
            
            if (x < width && y < height) {
                pixels[y * width + x] = color;
            }
            x++;
        }
    }
    
    /**
     * Trim transparent pixels from canvas
     */
    trimCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
        
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const alpha = data[(y * canvas.width + x) * 4 + 3];
                if (alpha > 0) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        if (maxX <= minX || maxY <= minY) {
            return { canvas, x: 0, y: 0 };
        }
        
        const trimmedWidth = maxX - minX + 1;
        const trimmedHeight = maxY - minY + 1;
        
        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = trimmedWidth;
        trimmedCanvas.height = trimmedHeight;
        
        const trimmedCtx = trimmedCanvas.getContext('2d');
        trimmedCtx.drawImage(canvas, minX, minY, trimmedWidth, trimmedHeight, 0, 0, trimmedWidth, trimmedHeight);
        
        return { canvas: trimmedCanvas, x: minX, y: minY };
    }
    
    /**
     * Queue bitmap for OCR processing
     */
    queueOCR(canvas, pts) {
        this.ocrQueue.push({ canvas, pts, time: pts / 90000 });
        this.processOCRQueue();
    }
    
    /**
     * Process OCR queue
     */
    async processOCRQueue() {
        if (this.processing || !this.tesseractReady || this.ocrQueue.length === 0) return;
        
        this.processing = true;
        
        while (this.ocrQueue.length > 0) {
            const item = this.ocrQueue.shift();
            
            try {
                // Convert canvas to image data URL
                const imageData = item.canvas.toDataURL('image/png');
                
                const result = await this.tesseractWorker.recognize(imageData);
                
                const text = result.data.text.trim();
                const confidence = result.data.confidence;
                
                if (text) {
                    this.stats.ocrProcessed++;
                    
                    this.onOCRResult({
                        text: text,
                        confidence: confidence,
                        pts: item.pts,
                        time: item.time,
                        canvas: item.canvas
                    });
                    
                    this.onSubtitle({
                        text: text,
                        startTime: item.time,
                        endTime: item.time + 5, // Default 5 second duration
                        confidence: confidence,
                        source: 'dvb-ocr'
                    });
                }
                
            } catch (err) {
                this.stats.errors++;
                this.onError('OCR error: ' + err.message);
            }
        }
        
        this.processing = false;
    }
    
    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            tesseractReady: this.tesseractReady,
            ocrQueueLength: this.ocrQueue.length,
            language: this.ocrLanguage
        };
    }
    
    /**
     * Reset decoder state
     */
    reset() {
        this.pages.clear();
        this.regions.clear();
        this.cluts.clear();
        this.objects.clear();
        this.ocrQueue = [];
        this.stats = { bitmapsDecoded: 0, ocrProcessed: 0, errors: 0 };
    }
    
    /**
     * Cleanup
     */
    async destroy() {
        if (this.tesseractWorker) {
            await this.tesseractWorker.terminate();
            this.tesseractWorker = null;
        }
        this.tesseractReady = false;
        this.reset();
    }
}

/**
 * MPEG-TS Demuxer for extracting subtitle streams
 * Since mpegts.js doesn't expose subtitle PIDs, we need to parse raw TS data
 */
export class TSSubtitleExtractor {
    constructor(options = {}) {
        this.onPES = options.onPES || (() => {});
        this.onPMT = options.onPMT || (() => {});
        this.onLog = options.onLog || console.log;
        
        this.subtitlePIDs = new Set();
        this.pesBuffers = new Map();
        this.pmtPID = null;
        
        // Known subtitle stream types
        this.SUBTITLE_TYPES = {
            0x06: 'DVB Teletext/Subtitles',
            0x59: 'DVB Subtitles',
            0x90: 'PGS Subtitles',
            0x91: 'IGS Subtitles'
        };
    }
    
    /**
     * Parse TS packet buffer
     */
    parse(buffer) {
        const data = new Uint8Array(buffer);
        let offset = 0;
        
        // Find sync byte
        while (offset < data.length - 188) {
            if (data[offset] === 0x47) {
                this.parsePacket(data.slice(offset, offset + 188));
                offset += 188;
            } else {
                offset++;
            }
        }
    }
    
    parsePacket(packet) {
        if (packet[0] !== 0x47) return;
        
        const pid = ((packet[1] & 0x1F) << 8) | packet[2];
        const payloadUnitStart = (packet[1] >> 6) & 0x01;
        const adaptationFieldControl = (packet[3] >> 4) & 0x03;
        
        let payloadOffset = 4;
        
        if (adaptationFieldControl & 0x02) {
            const adaptationFieldLength = packet[4];
            payloadOffset = 5 + adaptationFieldLength;
        }
        
        if (!(adaptationFieldControl & 0x01)) return; // No payload
        
        const payload = packet.slice(payloadOffset);
        
        // PAT (PID 0)
        if (pid === 0) {
            this.parsePAT(payload);
            return;
        }
        
        // PMT
        if (pid === this.pmtPID) {
            this.parsePMT(payload);
            return;
        }
        
        // Subtitle PID
        if (this.subtitlePIDs.has(pid)) {
            this.collectPES(pid, payload, payloadUnitStart);
        }
    }
    
    parsePAT(data) {
        // Skip pointer field if present
        let offset = data[0] + 1;
        
        if (offset + 8 > data.length) return;
        
        const tableId = data[offset];
        const sectionLength = ((data[offset + 1] & 0x0F) << 8) | data[offset + 2];
        
        offset += 8; // Skip to program loop
        
        while (offset < data.length - 4) {
            const programNumber = (data[offset] << 8) | data[offset + 1];
            const pid = ((data[offset + 2] & 0x1F) << 8) | data[offset + 3];
            
            if (programNumber !== 0) {
                this.pmtPID = pid;
            }
            offset += 4;
        }
    }
    
    parsePMT(data) {
        let offset = data[0] + 1;
        
        if (offset + 12 > data.length) return;
        
        const tableId = data[offset];
        const sectionLength = ((data[offset + 1] & 0x0F) << 8) | data[offset + 2];
        const programInfoLength = ((data[offset + 10] & 0x0F) << 8) | data[offset + 11];
        
        offset += 12 + programInfoLength;
        
        const streams = [];
        
        while (offset < data.length - 5) {
            const streamType = data[offset];
            const elementaryPID = ((data[offset + 1] & 0x1F) << 8) | data[offset + 2];
            const esInfoLength = ((data[offset + 3] & 0x0F) << 8) | data[offset + 4];
            
            // Check for subtitle stream types
            if (streamType === 0x06 || streamType === 0x59 || streamType >= 0x90) {
                // Check descriptors for subtitle tag (0x59)
                let descOffset = offset + 5;
                const descEnd = descOffset + esInfoLength;
                
                while (descOffset < descEnd && descOffset < data.length - 2) {
                    const descTag = data[descOffset];
                    const descLen = data[descOffset + 1];
                    
                    if (descTag === 0x59) { // DVB subtitling descriptor
                        this.subtitlePIDs.add(elementaryPID);
                        streams.push({
                            pid: elementaryPID,
                            type: streamType,
                            typeName: this.SUBTITLE_TYPES[streamType] || 'Unknown Subtitle'
                        });
                    }
                    
                    descOffset += 2 + descLen;
                }
            }
            
            offset += 5 + esInfoLength;
        }
        
        if (streams.length > 0) {
            this.onPMT(streams);
            this.onLog(`Found ${streams.length} subtitle stream(s): PIDs ${Array.from(this.subtitlePIDs).join(', ')}`);
        }
    }
    
    collectPES(pid, payload, start) {
        if (!this.pesBuffers.has(pid)) {
            this.pesBuffers.set(pid, { data: [], pts: 0 });
        }
        
        const buffer = this.pesBuffers.get(pid);
        
        if (start) {
            // New PES packet
            if (buffer.data.length > 0) {
                // Emit previous packet
                this.emitPES(pid, buffer);
            }
            
            // Parse PES header
            if (payload.length > 9 && payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x01) {
                const streamId = payload[3];
                const pesPacketLength = (payload[4] << 8) | payload[5];
                const ptsFlags = (payload[7] >> 6) & 0x03;
                const headerDataLength = payload[8];
                
                let pts = 0;
                if (ptsFlags & 0x02) {
                    pts = ((payload[9] & 0x0E) << 29) |
                          (payload[10] << 22) |
                          ((payload[11] & 0xFE) << 14) |
                          (payload[12] << 7) |
                          ((payload[13] & 0xFE) >> 1);
                }
                
                buffer.pts = pts;
                buffer.data = Array.from(payload.slice(9 + headerDataLength));
            }
        } else {
            // Continuation
            buffer.data.push(...payload);
        }
    }
    
    emitPES(pid, buffer) {
        if (buffer.data.length > 0) {
            this.onPES({
                pid: pid,
                pts: buffer.pts,
                data: new Uint8Array(buffer.data)
            });
        }
        buffer.data = [];
        buffer.pts = 0;
    }
    
    getSubtitlePIDs() {
        return Array.from(this.subtitlePIDs);
    }
    
    reset() {
        this.subtitlePIDs.clear();
        this.pesBuffers.clear();
        this.pmtPID = null;
    }
}
