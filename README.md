# HDHomeRun Stream Debugger

A simple debugging tool for testing HDHomeRun video streams and inspecting the HTML5 video element properties.

## Features

- **Stream Testing**: Play any HTTP stream URL directly
- **Video Element Inspector**: Browse all properties of the video element in a collapsible tree view
- **Event Logging**: Real-time log of all video element events (loadstart, canplay, error, etc.)
- **Status Bar**: Quick view of playback state, ready state, resolution, duration, and buffer status
- **Device Discovery**: Auto-discover HDHomeRun devices on your network

## Usage

1. Run a local HTTP server in this directory:
   ```bash
   # Node.js
   npx http-server . -p 8080
   
   # Python
   python -m http.server 8080
   ```

2. Open `http://localhost:8080` in your browser

3. The default stream URL is pre-filled (`http://172.16.0.242:5004/auto/v24`)

4. Click **Play** to start the stream

5. Use the **Inspector Panel** on the right to:
   - Browse the video element's properties
   - Click on expandable items (▶) to see nested properties
   - Use "Expand All" to see everything at once
   - Use "Refresh" to update the tree

6. Watch the **Events Log** at the bottom for real-time video events

## Default Stream URL

The default test stream is: `http://172.16.0.242:5004/auto/v24`

To test different channels, change the `v24` to:
- `v1` through `v999` - channel by virtual number
- `auto/v24` - auto-transcode (default)

## Device Discovery

Click the **🔍 Discover** button to scan for HDHomeRun devices on your network. When a device is found, clicking it will auto-fill the stream URL.
