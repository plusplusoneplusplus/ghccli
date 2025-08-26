#!/usr/bin/env python3
"""
GitHub Copilot CLI Session Viewer - Streamlit Version
Analyze and explore your Copilot CLI session logs with ease
"""

import streamlit as st
import json
import pandas as pd
from datetime import datetime
from pathlib import Path
import os
import glob
from typing import Dict, List, Any, Optional
import re
from collections import OrderedDict

# Set page config
st.set_page_config(
    page_title="GitHub Copilot CLI Session Viewer",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded"
)

class JSONLViewer:
    def __init__(self):
        self.data = []
        self.filtered_data = []
        self.session_groups = {}  # sessionId -> list of filenames
        
    def find_default_directory(self) -> Optional[str]:
        """Try to find the default sessions directory"""
        # Use pathlib for better cross-platform compatibility
        from pathlib import Path
        
        try:
            home = Path.home()
            default_paths = [
                home / ".ghccli" / "tmp" / "sessions"
            ]
            
            st.write(f"🔍 Debug: Checking default paths...")
            for path in default_paths:
                st.write(f"🔍 Debug: Checking path: {path}")
                if path.exists():
                    st.write(f"✅ Debug: Found existing path: {path}")
                    return str(path)
                else:
                    st.write(f"❌ Debug: Path does not exist: {path}")
        except Exception as e:
            st.error(f"🐛 Debug: Error in find_default_directory: {e}")
            
        st.write("🔍 Debug: No default directory found")
        return None
        
    def get_jsonl_files_from_directory(self, directory_path: str, limit: int = 10) -> List[str]:
        """Get JSONL files from a directory, sorted by modification time (newest first), limited to specified count"""
        if not os.path.exists(directory_path):
            return []
            
        jsonl_files = glob.glob(os.path.join(directory_path, "*.jsonl"))
        # Sort by modification time, newest first
        jsonl_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        
        # Limit to the specified number of files
        return jsonl_files[:limit]
        
    def load_file(self, file_content: str, filename: str = "") -> List[Dict]:
        """Load and parse JSONL file content"""
        lines = file_content.strip().split('\n')
        data = []
        
        for i, line in enumerate(lines):
            if line.strip():
                try:
                    item = json.loads(line)
                    # Add source file information
                    item['_source_file'] = filename
                    data.append(item)
                except json.JSONDecodeError as e:
                    st.warning(f"Skipping invalid JSON on line {i+1} in {filename}: {str(e)}")
                    
        return data
        
    def load_files_from_directory(self, directory_path: str, limit: int = 10) -> Dict[str, List[Dict]]:
        """Load limited number of JSONL files from a directory (most recent files first)"""        
        files_data = OrderedDict()  # Preserve order - newest first
        jsonl_files = self.get_jsonl_files_from_directory(directory_path, limit)
        
        if not jsonl_files:
            return files_data
        
        for file_path in jsonl_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    filename = os.path.basename(file_path)
                    data = self.load_file(content, filename)
                    if data is not None:
                        files_data[filename] = data
            except Exception as e:
                st.error(f"Error loading {file_path}: {str(e)}")
                
        return files_data
        
    def extract_session_id(self, filename: str, data: List[Dict]) -> Optional[str]:
        """Extract sessionId from log entries, else derive from filename pattern"""
        # First try to extract from data entries
        for item in data:
            if isinstance(item, dict):
                sid = item.get('sessionId')
                if sid:
                    return sid
        
        # Try filename pattern matching: yyyy_MM_dd_hh_mm_ss_<sessionId>.jsonl
        m = re.match(r'^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_(.+)\.jsonl$', filename)
        if m:
            return m.group(1)
        
        # If no pattern match, use the entire filename as session ID (without extension)
        return filename.replace('.jsonl', '')

    def build_session_groups(self, files_data: Dict[str, List[Dict]]) -> Dict[str, List[str]]:
        """Group files by session ID"""
        groups: Dict[str, List[str]] = {}
        for filename, data in files_data.items():
            try:
                sid = self.extract_session_id(filename, data)
                if sid:
                    groups.setdefault(sid, []).append(filename)
            except Exception as e:
                st.warning(f"Grouping error for {filename}: {e}")
        
        # Sort files within each group
        for sid in groups:
            groups[sid].sort()
        
        self.session_groups = groups
        return groups
        
    def render_chat_details(self, data: List[Dict], session_name: str):
        """Render chat details for the selected session"""
        st.header(f"� Chat Details: {session_name}")
        
        if not data:
            st.info("No interactions found in this session")
            return
        
        # Calculate and display stats
        stats = self.calculate_stats(data)
        
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Total Interactions", stats['total_interactions'])
        with col2:
            st.metric("Total Tokens", f"{stats['total_tokens']:,}")
        with col3:
            st.metric("Models Used", stats['unique_models'])
        with col4:
            st.metric("Session Duration", stats['session_duration'])
        
        # Display interactions
        st.subheader("Conversation Flow")
        
        for i, item in enumerate(data):
            timestamp = "No timestamp"
            if item.get('timestamp'):
                try:
                    dt = datetime.fromisoformat(item['timestamp'].replace('Z', '+00:00'))
                    timestamp = dt.strftime('%H:%M:%S')
                except:
                    timestamp = item['timestamp']
            
            with st.expander(
                f"🔄 Interaction {i+1} - "
                f"{item.get('model', 'Unknown')} - "
                f"{timestamp}"
            ):
                # Token usage
                if item.get('tokenUsage'):
                    usage = item['tokenUsage']
                    token_cols = st.columns(4)
                    with token_cols[0]:
                        st.metric("Prompt Tokens", usage.get('promptTokens', 0))
                    with token_cols[1]:
                        st.metric("Completion Tokens", usage.get('completionTokens', 0))
                    with token_cols[2]:
                        st.metric("Total Tokens", usage.get('totalTokens', 0))
                    with token_cols[3]:
                        if usage.get('cachedTokens'):
                            st.metric("Cached Tokens", usage.get('cachedTokens', 0))
                
                # Request section
                if item.get('request') and item['request'].get('messages'):
                    st.subheader("📤 Messages")
                    for msg in item['request']['messages']:
                        role = msg.get('role', 'unknown').upper()
                        content = msg.get('content', '')
                        
                        if content:
                            st.markdown(f"**{role}:**")
                            st.text(content[:500] + "..." if len(content) > 500 else content)
                        
                        # Show tool calls if present
                        if msg.get('tool_calls'):
                            st.markdown("**Tool Calls:**")
                            for tool_call in msg['tool_calls']:
                                function_name = tool_call.get('function', {}).get('name', 'Unknown')
                                st.code(f"Function: {function_name}")
                
                # Response section
                if item.get('response') and item['response'].get('choices'):
                    st.subheader("📥 Response")
                    for choice in item['response']['choices']:
                        if choice.get('message', {}).get('content'):
                            st.markdown("**Assistant:**")
                            response_content = choice['message']['content']
                            st.text(response_content[:500] + "..." if len(response_content) > 500 else response_content)
        
    def calculate_stats(self, data: List[Dict]) -> Dict:
        """Calculate session statistics"""
        interactions = [item for item in data if item.get('tokenUsage')]
        total_tokens = sum(item.get('tokenUsage', {}).get('totalTokens', 0) for item in interactions)
        
        models = set(item.get('model') for item in data if item.get('model'))
        
        timestamps = []
        for item in data:
            if item.get('timestamp'):
                try:
                    timestamps.append(datetime.fromisoformat(item['timestamp'].replace('Z', '+00:00')))
                except:
                    pass
        
        timestamps.sort()
        
        if len(timestamps) > 1:
            duration = (timestamps[-1] - timestamps[0]).total_seconds() / 60
            duration_str = f"{int(duration)} min"
        else:
            duration_str = "N/A"
            
        return {
            'total_interactions': len(data),
            'total_tokens': total_tokens,
            'unique_models': len(models),
            'session_duration': duration_str,
            'avg_tokens_per_interaction': int(total_tokens / len(interactions)) if interactions else 0,
            'models': list(models)
        }
        
    def filter_data(self, data: List[Dict], model_filter: str, search_filter: str, min_tokens: int) -> List[Dict]:
        """Apply filters to the data"""
        filtered = data
        
        if model_filter and model_filter != "All Models":
            filtered = [item for item in filtered if item.get('model') == model_filter]
            
        if search_filter:
            search_lower = search_filter.lower()
            filtered = [item for item in filtered if search_lower in json.dumps(item, default=str).lower()]
            
        if min_tokens > 0:
            filtered = [item for item in filtered 
                       if item.get('tokenUsage', {}).get('totalTokens', 0) >= min_tokens]
                       
        return filtered

def main():
    st.title("🤖 GitHub Copilot CLI Session Viewer")
    st.markdown("Analyze and explore your Copilot CLI session logs with ease")
    
    viewer = JSONLViewer()
    
    # Auto-load last 10 sessions on startup
    if 'files_data' not in st.session_state:
        default_dir = viewer.find_default_directory()
        if default_dir and os.path.exists(default_dir):
            try:
                files_data = viewer.load_files_from_directory(default_dir, 10)
                if files_data:
                    viewer.build_session_groups(files_data)
                    st.session_state['files_data'] = files_data
                    st.session_state['directory_path'] = default_dir
                    st.session_state['session_groups'] = viewer.session_groups
                    st.rerun()
            except Exception as e:
                st.error(f"Failed to auto-load sessions: {e}")
    
    # Left panel - Session Groups
    with st.sidebar:
        st.header("📋 Recent Sessions")
        
        # Manual directory loading option
        st.subheader("🔄 Load Different Directory")
        directory_path = st.text_input(
            "Directory Path:",
            value=st.session_state.get('directory_path', ''),
            help="Enter path to JSONL files directory"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Load Sessions"):
                if directory_path and os.path.exists(directory_path):
                    try:
                        files_data = viewer.load_files_from_directory(directory_path, 10)
                        if files_data:
                            viewer.build_session_groups(files_data)
                            st.session_state['files_data'] = files_data
                            st.session_state['directory_path'] = directory_path
                            st.session_state['session_groups'] = viewer.session_groups
                            st.rerun()
                        else:
                            st.error("No JSONL files found")
                    except Exception as e:
                        st.error(f"Loading error: {e}")
                else:
                    st.error("Directory does not exist")
        
        with col2:
            if st.button("🔄 Reload"):
                current_dir = st.session_state.get('directory_path')
                if current_dir and os.path.exists(current_dir):
                    try:
                        files_data = viewer.load_files_from_directory(current_dir, 10)
                        if files_data:
                            viewer.build_session_groups(files_data)
                            st.session_state['files_data'] = files_data
                            st.session_state['session_groups'] = viewer.session_groups
                            st.rerun()
                    except Exception as e:
                        st.error(f"Reload error: {e}")
        
        # Display session groups
        if 'session_groups' in st.session_state and st.session_state['session_groups']:
            st.markdown("---")
            st.subheader("📁 Session Groups")
            
            session_groups = st.session_state['session_groups']
            files_data = st.session_state['files_data']
            
            # Sort groups by most recent file modification time
            sorted_groups = sorted(
                session_groups.items(),
                key=lambda x: max([
                    os.path.getmtime(os.path.join(st.session_state.get('directory_path', ''), f))
                    for f in x[1] 
                    if os.path.exists(os.path.join(st.session_state.get('directory_path', ''), f))
                ] + [0]),
                reverse=True
            )
            
            for session_id, filenames in sorted_groups:
                with st.expander(f"📂 {session_id[:12]}... ({len(filenames)} files)", expanded=True):
                    total_interactions = sum(len(files_data.get(f, [])) for f in filenames)
                    st.caption(f"Total interactions: {total_interactions}")
                    
                    for filename in sorted(filenames):
                        file_data = files_data.get(filename, [])
                        is_selected = st.session_state.get('selected_file') == filename
                        
                        if st.button(
                            f"📄 {filename} ({len(file_data)} interactions)",
                            key=f"file_{filename}",
                            type="primary" if is_selected else "secondary",
                            use_container_width=True
                        ):
                            st.session_state['selected_file'] = filename
                            st.session_state['selected_session_id'] = session_id
                            st.rerun()
            
            # Summary
            st.markdown("---")
            total_files = len(files_data)
            total_interactions = sum(len(data) for data in files_data.values())
            st.caption(f"📊 **Total**: {total_files} files, {total_interactions} interactions")
        
        elif 'files_data' in st.session_state:
            st.info("No session groups found. Files may not have session IDs.")
        else:
            st.info("No sessions loaded. Use the load button above.")
    
    # Main panel - Chat Details
    if st.session_state.get('selected_file') and 'files_data' in st.session_state:
        selected_file = st.session_state['selected_file']
        files_data = st.session_state['files_data']
        
        if selected_file in files_data:
            data = files_data[selected_file]
            viewer.render_chat_details(data, selected_file)
        else:
            st.error("Selected file not found in loaded data")
    
    elif 'files_data' in st.session_state:
        st.info("👈 Select a session file from the sidebar to view chat details")
    
    else:
        st.info("👆 Load session files to get started")
        st.markdown("""
        ### Expected File Format
        The tool expects JSONL files from GitHub Copilot CLI sessions, typically found at:
        - **Windows:** `C:\\Users\\[username]\\.ghccli\\tmp\\sessions\\`
        - **macOS/Linux:** `~/.ghccli/tmp/sessions/`
        """)

if __name__ == "__main__":
    main()