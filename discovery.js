// Detect local IP address and extract subnet prefix using WebRTC
export async function detectLocalSubnet() {
    return new Promise((resolve) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

        pc.createDataChannel('');
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .catch(() => {
                resolve(null); // Fallback if WebRTC fails
            });

        const timeout = setTimeout(() => {
            resolve(null);
            pc.close();
        }, 3000);

        pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate) return;

            const ipMatch = ice.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
            if (ipMatch) {
                clearTimeout(timeout);
                pc.close();

                const ip = ipMatch[1];
                // Extract subnet prefix (first 3 octets)
                const subnet = ip.split('.').slice(0, 3).join('.');
                resolve(subnet);
            }
        };
    });
}

// Scan a specific IP for discover.json
export async function discoverByIP(ip) {
    try {
        const resp = await fetch(`http://${ip}/discover.json`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            const d = await resp.json();
            return {
                DeviceID: d.DeviceID,
                DeviceAuth: d.DeviceAuth,
                BaseURL: d.BaseURL.replace(/\/$/, "")
            };
        }
    } catch (err) {
        console.warn(`Device not found at ${ip}:`, err.message);
    }
    return null;
}

// Scan a subnet for HDHomeRun devices
export async function scanSubnet(subnetPrefix, onProgress) {
    const results = [];
    const batchSize = 10; // Concurrent requests
    const timeout = 2000; // 2s timeout per request

    // Scan .1 to .254
    for (let batch = 1; batch <= 254; batch += batchSize) {
        const promises = [];
        for (let i = 0; i < batchSize && batch + i <= 254; i++) {
            const ip = `${subnetPrefix}.${batch + i}`;
            promises.push(
                (async () => {
                    try {
                        const resp = await fetch(`http://${ip}/discover.json`, { signal: AbortSignal.timeout(timeout) });
                        if (resp.ok) {
                            const d = await resp.json();
                            const device = {
                                DeviceID: d.DeviceID,
                                DeviceAuth: d.DeviceAuth,
                                BaseURL: d.BaseURL.replace(/\/$/, "")
                            };
                            results.push(device);
                            if (onProgress) onProgress(device);
                            return device;
                        }
                    } catch (err) {
                        // Silently continue on timeout/error
                    }
                    return null;
                })()
            );
        }
        await Promise.all(promises);
    }
    return results;
}

export async function discoverHDHR() {
    // 1. Try mDNS first
    try {
        const resp = await fetch("http://hdhomerun.local/discover.json", { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            const d = await resp.json();
            return {
                DeviceID: d.DeviceID,
                DeviceAuth: d.DeviceAuth,
                BaseURL: d.BaseURL.replace(/\/$/, "")
            };
        }
    } catch (err) {
        console.warn("mDNS discovery failed, falling back to cloud…");
    }

    // 2. Fallback: SiliconDust cloud discovery
    try {
        const resp = await fetch("https://discover.hdhomerun.com/discover", { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
            let devices = await resp.json();
            if (!Array.isArray(devices)) devices = [devices];
            if (devices.length > 0) {
                const tuner = devices.find(d => d.DeviceID && d.BaseURL) || devices[0];
                return {
                    DeviceID: tuner.DeviceID,
                    DeviceAuth: tuner.DeviceAuth,
                    BaseURL: tuner.BaseURL.replace(/\/$/, "")
                };
            }
        }
    } catch (err) {
        console.warn("Cloud discovery failed");
    }

    throw new Error("Discovery failed - please use manual entry");
}
