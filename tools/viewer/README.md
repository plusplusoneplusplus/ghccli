# GitHub Copilot CLI Session Viewer (Streamlit)

A Python Streamlit-based tool for analyzing and exploring GitHub Copilot CLI session logs with an intuitive web interface.

## Features

- 📊 **Interactive Dashboard**: View session statistics including total interactions, tokens, models used, and session duration
- 🔍 **Advanced Filtering**: Filter by model, search content, minimum token count
- 💬 **Incremental Message View**: Show only new messages in each interaction for cleaner analysis
- 🔧 **Tool Call Visualization**: Special formatting for tool calls and results
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🚀 **Auto-Discovery**: Automatically suggests recent session files

## Quick Start

### Option 1: Run Scripts
```bash
# Windows Command Prompt
run_viewer.bat

# Windows PowerShell
.\run_viewer.ps1
```

### Option 2: Manual Setup
```bash
# Install dependencies
pip install -r requirements.txt

# Run the application
streamlit run jsonl_viewer.py
```

## Usage

1. **Launch the application** using one of the methods above
2. **Load a session file**:
   - Upload a JSONL file using the sidebar file uploader, OR
   - Use the auto-suggested default file if available
3. **Explore your data**:
   - View session statistics in the metrics row
   - Use filters to narrow down interactions
   - Expand individual interactions to see details
   - Toggle incremental message view for cleaner analysis

## Session File Locations

The tool automatically looks for session files in standard locations:
- **Windows**: `C:\Users\[username]\.ghccli\tmp\sessions\`
- **macOS/Linux**: `~/.ghccli/tmp/sessions/`

## Features Comparison with HTML Version

| Feature | HTML Version | Streamlit Version |
|---------|--------------|-------------------|
| File Loading | ✅ | ✅ (Enhanced with auto-discovery) |
| Statistics Dashboard | ✅ | ✅ (Interactive metrics) |
| Filtering | ✅ | ✅ (Real-time updates) |
| Incremental Messages | ✅ | ✅ (Improved rendering) |
| Tool Call Visualization | ✅ | ✅ (Enhanced formatting) |
| Responsive Design | ✅ | ✅ (Native Streamlit responsive) |
| Search Functionality | ✅ | ✅ |
| Token Analysis | ✅ | ✅ |
| Cross-platform | Browser only | Native Python app |

## Requirements

- Python 3.7+
- Streamlit 1.28.0+
- Pandas 1.5.0+

## File Structure

```
tools/eval/
├── jsonl_viewer.py      # Main Streamlit application
├── jsonl_viewer.html    # Original HTML version (preserved)
├── requirements.txt     # Python dependencies
├── run_viewer.bat       # Windows batch launcher
├── run_viewer.ps1       # PowerShell launcher
└── README.md           # This file
```

## Development

The Streamlit version offers several advantages over the HTML version:

1. **Better Data Handling**: Uses pandas for efficient data processing
2. **Interactive Widgets**: Real-time filtering and searching
3. **Extensibility**: Easy to add new features and visualizations
4. **Python Ecosystem**: Can leverage any Python library for analysis
5. **State Management**: Better handling of user interactions and data state

## Troubleshooting

### Port Already in Use
If you get a port conflict, Streamlit will automatically suggest an alternative port.

### File Not Found
Ensure your JSONL files are in the expected locations or use the file uploader.

### Performance Issues
For very large session files (>10MB), consider using the filtering options to reduce the data displayed.

## Contributing

Feel free to enhance the tool with additional features such as:
- Data export functionality
- Advanced visualizations
- Token usage graphs
- Session comparison tools
- Custom themes