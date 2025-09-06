# GitHub Copilot CLI Session Viewer

A pure HTML-based tool for analyzing and exploring GitHub Copilot CLI session logs with an intuitive web interface that runs entirely in your browser.

## Features

- 📊 **Interactive Dashboard**: View session statistics including total interactions, tokens, models used, and session duration
- 🗂️ **Drag & Drop Support**: Drop JSONL files anywhere on the page to load them instantly
- 📁 **Directory Picker**: One-click access to your sessions folder (Chrome/Edge)
- 🧩 **Session Grouping**: Automatically groups related files by session ID for unified viewing
- 💬 **Full Content Display**: View complete messages with smart expand/collapse for long content
- 🔧 **Tool Call Visualization**: Special formatting for tool calls and function names
- 📱 **Responsive Design**: Works on desktop and mobile devices
- ⚡ **No Dependencies**: Pure HTML/CSS/JavaScript - no installation required

## Quick Start

1. **Open the viewer**: Simply open `jsonl_viewer.html` in any modern web browser
2. **Load sessions**: Choose one of three methods:
   - **📁 Click "Open Sessions Folder"** - Navigate to `~/.ghccli/tmp/sessions/` (recommended)
   - **🗂️ Drag & drop** - Drop JSONL files directly onto the page
   - **📄 File picker** - Use "Choose Files" to select individual files

## Usage

### Loading Sessions
- **Directory Picker** (recommended): Click "📁 Open Sessions Folder" and navigate to your sessions directory
- **Drag & Drop**: Drag JSONL files from your file manager directly onto the viewer
- **File Selection**: Use "Choose Files" to manually select specific JSONL files

### Navigation
- **Session Groups**: Files are automatically grouped by session ID in the left sidebar
- **File Selection**: Click any file to view its conversation details in the main panel  
- **Expand/Collapse**: Use arrow buttons to expand session groups and interaction details
- **Long Content**: Messages over 1000 characters show an "Expand" button for full viewing

### macOS Directory Access
To access `~/.ghccli/tmp/sessions/` on macOS:
1. In the directory picker, press `Cmd + Shift + G`
2. Type: `~/.ghccli/tmp/sessions`
3. Press Enter

## Session File Locations

The tool automatically looks for session files in standard locations:
- **Windows**: `C:\Users\[username]\.ghccli\tmp\sessions\`
- **macOS/Linux**: `~/.ghccli/tmp/sessions/`

### Session Correlation Logic

Many CLI runs that invoke sub-agents create multiple OpenAI JSONL log files that nonetheless share a common logical `sessionId`.

This viewer detects and groups those files using the following heuristics:
1. If a log entry contains a `sessionId` field, that value is authoritative.
2. Otherwise, it parses the filename pattern: `yyyy_MM_dd_hh_mm_ss_<sessionId>.jsonl` and uses the trailing segment as the `sessionId`.
3. All files with the same resolved `sessionId` are shown under a single group in the sidebar (when grouping is enabled).
4. Within a group, files are ordered lexicographically (timestamp prefix) and their entries are merged and chronologically sorted by individual entry timestamps.

This provides a lightweight, non-invasive way to correlate parent agent activity with sub-agent executions without modifying existing log generation.

## Browser Compatibility

| Feature | Chrome/Edge | Firefox | Safari |
|---------|-------------|---------|--------|
| Basic Functionality | ✅ | ✅ | ✅ |
| Drag & Drop | ✅ | ✅ | ✅ |
| Directory Picker | ✅ | ❌ | ❌ |
| File Selection | ✅ | ✅ | ✅ |

**Note**: Directory picker requires the File System Access API (Chrome/Edge only). Other browsers can use drag & drop or file selection.

## Requirements

- Any modern web browser
- No installation or dependencies required

## File Structure

```
tools/viewer/
├── jsonl_viewer.html    # Main HTML application
├── styles.css           # Styling and themes
├── script.js           # JavaScript functionality
└── README.md           # This file
```

## Development

This HTML-based viewer offers several advantages:

1. **Zero Dependencies**: No installation required - works in any browser
2. **Portable**: Single HTML file can be shared or embedded anywhere
3. **Fast Loading**: Instant startup with no server setup
4. **Cross-Platform**: Works on any device with a modern browser
5. **Customizable**: Easy to modify CSS and JavaScript for custom themes

## Troubleshooting

### Directory Picker Not Working
- **Chrome/Edge**: Should work natively
- **Firefox/Safari**: Use drag & drop or file selection instead

### Files Not Loading
- Ensure files have `.jsonl` extension
- Check that files contain valid JSON lines
- Try drag & drop if file picker isn't working

### Performance with Large Files
- Files over 10MB may load slowly
- Use the expand/collapse feature to manage long conversations
- Consider splitting very large session files

## Contributing

Feel free to enhance the tool with additional features such as:
- **Export functionality**: Download conversations as text/JSON
- **Search and filtering**: Find specific interactions or content  
- **Token usage graphs**: Visual analytics for usage patterns
- **Session comparison**: Side-by-side session analysis
- **Custom themes**: Additional color schemes and layouts
- **Keyboard shortcuts**: Power user navigation features

To contribute:
1. Edit the HTML, CSS, or JavaScript files
2. Test in multiple browsers
3. Submit improvements via pull request