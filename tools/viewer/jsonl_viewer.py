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
        self.previous_messages = {}  # Track previous messages for incremental display
        self.all_files_data = {}  # Store data from all loaded files
        self.agent_relationships = {}  # Track parent-child agent relationships
    self.session_groups = {}  # sessionId -> list of filenames (simple correlation)
        
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
        st.write(f"🔍 Debug: Loading files from directory: {directory_path}, limit: {limit}")
        
        files_data = OrderedDict()  # Preserve order - newest first
        jsonl_files = self.get_jsonl_files_from_directory(directory_path, limit)
        
        st.write(f"🔍 Debug: Found {len(jsonl_files)} JSONL files")
        if not jsonl_files:
            st.warning(f"🔍 Debug: No JSONL files found in {directory_path}")
            return files_data
        
        for i, file_path in enumerate(jsonl_files):
            try:
                st.write(f"🔍 Debug: Loading file {i+1}/{len(jsonl_files)}: {file_path}")
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    filename = os.path.basename(file_path)
                    data = self.load_file(content, filename)
                    if data is not None:
                        files_data[filename] = data
                        st.write(f"✅ Debug: Successfully loaded {len(data)} items from {filename}")
                    else:
                        st.warning(f"⚠️ Debug: load_file returned None for {filename}")
            except Exception as e:
                st.error(f"🐛 Debug: Error loading {file_path}: {str(e)}")
                
        st.write(f"🔍 Debug: Total files loaded: {len(files_data)}")
        return files_data
        
    def combine_files_data(self, files_data: Dict[str, List[Dict]]) -> List[Dict]:
        """Combine data from multiple files into a single list"""
        combined_data = []
        for filename, data in files_data.items():
            combined_data.extend(data)
            
        # Sort by timestamp if available
        def get_timestamp(item):
            try:
                if item.get('timestamp'):
                    return datetime.fromisoformat(item['timestamp'].replace('Z', '+00:00'))
            except:
                pass
            return datetime.min
            
        combined_data.sort(key=get_timestamp)
        return combined_data
        
    def analyze_agent_relationships(self, files_data: Dict[str, List[Dict]]) -> Dict[str, Dict]:
        """Analyze files to detect agent invocation relationships"""
        st.write(f"🔍 Debug: Analyzing agent relationships for {len(files_data)} files")
        
        if not files_data:
            st.warning("🔍 Debug: files_data is empty")
            return {}
            
        relationships = {}
        
        for filename, data in files_data.items():
            try:
                st.write(f"🔍 Debug: Analyzing file: {filename}")
                
                if data is None:
                    st.warning(f"⚠️ Debug: Data is None for {filename}")
                    continue
                    
                if not isinstance(data, list):
                    st.warning(f"⚠️ Debug: Data is not a list for {filename}, type: {type(data)}")
                    continue
                    
                session_id = None
                has_agent_invocation = False
                child_execution_ids = []
                
                # Extract session ID and detect agent invocations
                for i, item in enumerate(data):
                    try:
                        if item is None:
                            st.warning(f"⚠️ Debug: Item {i} is None in {filename}")
                            continue
                            
                        if not isinstance(item, dict):
                            st.warning(f"⚠️ Debug: Item {i} is not a dict in {filename}, type: {type(item)}")
                            continue
                            
                        if item.get('sessionId'):
                            session_id = item['sessionId']
                        
                        # Check for agent invocation tool calls
                        if (item.get('request', {}).get('messages')):
                            for message in item['request']['messages']:
                                if message and message.get('tool_calls'):
                                    for tool_call in message['tool_calls']:
                                        if (tool_call and tool_call.get('function', {}).get('name') == 'invoke_agents' or
                                            'invoke_agents' in tool_call.get('function', {}).get('name', '')):
                                            has_agent_invocation = True
                        
                        # Check for child execution IDs in responses
                        if item.get('response', {}).get('choices', []):
                            for choice in item['response']['choices']:
                                if choice and choice.get('message', {}).get('tool_calls'):
                                    # This indicates a tool call response with potential child execution IDs
                                    pass
                                
                        # Check tool results for child execution IDs
                        if (item.get('request', {}).get('messages')):
                            for message in item['request']['messages']:
                                if message and message.get('role') == 'tool' and 'childExecutionId' in message.get('content', ''):
                                    try:
                                        content = json.loads(message['content'])
                                        if isinstance(content, dict) and content.get('output'):
                                            output_data = json.loads(content['output'])
                                            if 'results' in output_data:
                                                for result in output_data['results']:
                                                    if result and result.get('childExecutionId'):
                                                        child_execution_ids.append(result['childExecutionId'])
                                    except (json.JSONDecodeError, TypeError) as e:
                                        st.warning(f"⚠️ Debug: JSON parsing error in {filename}: {e}")
                                        
                    except Exception as e:
                        st.error(f"🐛 Debug: Error processing item {i} in {filename}: {e}")
                        continue
                
                relationships[filename] = {
                    'session_id': session_id,
                    'has_agent_invocation': has_agent_invocation,
                    'child_execution_ids': child_execution_ids,
                    'is_sub_agent': self._is_sub_agent_file(filename, data),
                    'parent_execution_id': self._extract_parent_execution_id(data)
                }
                
                st.write(f"✅ Debug: Processed {filename} - Agent invocation: {has_agent_invocation}, Child IDs: {len(child_execution_ids)}")
                
            except Exception as e:
                st.error(f"🐛 Debug: Error analyzing {filename}: {e}")
                relationships[filename] = {
                    'session_id': None,
                    'has_agent_invocation': False,
                    'child_execution_ids': [],
                    'is_sub_agent': False,
                    'parent_execution_id': ''
                }
        
        # Find parent-child relationships
        for filename, info in relationships.items():
            if info and info.get('child_execution_ids'):
                for other_filename, other_info in relationships.items():
                    if (other_filename != filename and other_info and
                        other_info.get('parent_execution_id') in info['child_execution_ids']):
                        relationships[filename].setdefault('children', []).append(other_filename)
                        relationships[other_filename]['parent'] = filename
        
        st.write(f"🔍 Debug: Relationship analysis complete for {len(relationships)} files")
        return relationships

    # ------------------ Simple sessionId grouping (Option 1 implementation) ------------------
    def extract_session_id(self, filename: str, data: List[Dict]) -> Optional[str]:
        """Extract sessionId from log entries, else derive from filename pattern.

        Supported filename pattern: yyyy_MM_dd_hh_mm_ss_<sessionId>.jsonl
        """
        for item in data:
            if isinstance(item, dict):
                sid = item.get('sessionId')
                if sid:
                    return sid
        m = re.match(r'^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_(.+)\.jsonl$', filename)
        if m:
            return m.group(1)
        return None

    def build_session_groups(self, files_data: Dict[str, List[Dict]]) -> Dict[str, List[str]]:
        groups: Dict[str, List[str]] = {}
        for filename, data in files_data.items():
            try:
                sid = self.extract_session_id(filename, data)
                if not sid:
                    continue
                groups.setdefault(sid, []).append(filename)
            except Exception as e:
                st.warning(f"Grouping error for {filename}: {e}")
        for sid in groups:
            groups[sid].sort()  # timestamp prefix provides chronological order
        self.session_groups = groups
        return groups
    
    def _is_sub_agent_file(self, filename: str, data: List[Dict]) -> bool:
        """Check if this file appears to be from a sub-agent"""
        # Look for execution IDs that suggest sub-agent pattern
        for item in data:
            interaction_id = item.get('interactionId', '')
            if 'agent-exec-' in interaction_id or 'exec-' in interaction_id:
                return True
        return False
    
    def _extract_parent_execution_id(self, data: List[Dict]) -> str:
        """Extract parent execution ID from sub-agent data"""
        for item in data:
            interaction_id = item.get('interactionId', '')
            if 'agent-exec-' in interaction_id:
                # Extract the execution pattern
                parts = interaction_id.split('-')
                if len(parts) >= 4:
                    return '-'.join(parts[2:4])  # Extract middle part as execution ID
        return ''
    
    def get_agent_hierarchy_info(self, filename: str) -> Dict:
        """Get hierarchy information for a specific file"""
        if filename not in self.agent_relationships:
            return {}
        
        info = self.agent_relationships[filename].copy()
        
        # Add display strings
        if info.get('has_agent_invocation'):
            info['type_display'] = '🔀 Main Agent (Invokes Sub-agents)'
        elif info.get('is_sub_agent'):
            info['type_display'] = '🤖 Sub-agent'
        else:
            info['type_display'] = '📄 Standard Session'
        
        return info
        
    def calculate_stats(self, data: List[Dict]) -> Dict:
        """Calculate session statistics"""
        interactions = [item for item in data if item.get('tokenUsage')]
        total_tokens = sum(item.get('tokenUsage', {}).get('totalTokens', 0) for item in interactions)
        
        models = set(item.get('model') for item in data if item.get('model'))
        
        timestamps = [datetime.fromisoformat(item['timestamp'].replace('Z', '+00:00')) 
                     for item in data if item.get('timestamp')]
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
        
    def render_tool_calls(self, tool_calls: List[Dict]) -> str:
        """Render tool calls in a readable format"""
        result = ""
        for tool_call in tool_calls:
            function_name = tool_call.get('function', {}).get('name', 'Unknown Function')
            parameters = tool_call.get('function', {}).get('arguments', '{}')
            tool_id = tool_call.get('id', 'N/A')
            
            try:
                parsed_params = json.loads(parameters)
                params_str = json.dumps(parsed_params, indent=2)
            except:
                params_str = str(parameters)
            
            # Highlight agent invocation tool calls
            if 'invoke_agents' in function_name:
                icon = "🔀"
                call_type = "Agent Invocation"
            else:
                icon = "🔧"
                call_type = "Tool Call"
                
            result += f"**{icon} {call_type}: {function_name}** (ID: {tool_id})\n\n"
            
            # For agent invocations, show summary of agents being invoked
            if 'invoke_agents' in function_name:
                try:
                    params = json.loads(parameters)
                    if 'agents' in params:
                        agent_summary = []
                        for agent in params['agents']:
                            agent_name = agent.get('agentName', 'Unknown')
                            task_desc = agent.get('taskDescription', agent.get('message', '')[:50] + '...')
                            agent_summary.append(f"• **{agent_name}**: {task_desc}")
                        if agent_summary:
                            result += "**🤖 Agents to invoke:**\n" + "\n".join(agent_summary) + "\n\n"
                except:
                    pass
            
            result += f"```json\n{params_str}\n```\n\n"
            
        return result
        
    def render_tool_result(self, tool_message: Dict) -> str:
        """Render tool result in a readable format"""
        tool_call_id = tool_message.get('tool_call_id', 'Unknown')
        content = tool_message.get('content', '')
        
        try:
            parsed_content = json.loads(content)
            content_str = json.dumps(parsed_content, indent=2)
        except:
            content_str = str(content)
            
        is_error = 'error' in content.lower() or 'failed' in content.lower()
        
        # Check if this is an agent invocation result
        is_agent_result = False
        child_execution_ids = []
        
        try:
            parsed_content = json.loads(content)
            if isinstance(parsed_content, dict) and parsed_content.get('output'):
                output_data = json.loads(parsed_content['output'])
                if 'results' in output_data and 'totalAgents' in output_data:
                    is_agent_result = True
                    for result in output_data['results']:
                        if result.get('childExecutionId'):
                            child_execution_ids.append(result['childExecutionId'])
        except:
            pass
        
        if is_agent_result:
            icon = "🔀"
            result_type = "Agent Invocation Result"
        else:
            icon = "❌" if is_error else "✅"
            result_type = "Tool Result"
        
        result = f"**{icon} {result_type}** (ID: {tool_call_id})\n\n"
        
        # Show summary for agent results
        if is_agent_result and child_execution_ids:
            result += f"**🤖 Generated {len(child_execution_ids)} sub-agent execution(s):**\n"
            for exec_id in child_execution_ids:
                result += f"• `{exec_id}`\n"
            result += "\n"
        
        result += f"```\n{content_str}\n```\n\n"
        
        return result
        
    def render_incremental_messages(self, messages: List[Dict], session_id: str) -> str:
        """Render only new messages incrementally"""
        # Use selected session as session_id for directory mode
        if st.session_state.get('loading_mode') == 'directory':
            session_id = st.session_state.get('selected_session', session_id)
            
        previous_messages = self.previous_messages.get(session_id, [])
        new_messages = messages[len(previous_messages):]
        
        # Update previous messages state
        self.previous_messages[session_id] = messages.copy()
        
        if not new_messages and previous_messages:
            return "*No new messages in this interaction*"
            
        result = ""
        for msg in new_messages:
            role = msg.get('role', 'unknown').upper()
            
            # Handle different message types
            if msg.get('role') == 'assistant' and msg.get('tool_calls'):
                result += self.render_tool_calls(msg['tool_calls'])
            elif msg.get('role') == 'tool':
                result += self.render_tool_result(msg)
            else:
                content = msg.get('content', json.dumps(msg, indent=2))
                result += f"**{role}:**\n\n{content}\n\n"
                
        return result if result else "*Empty message*"

def main():
    st.title("🤖 GitHub Copilot CLI Session Viewer")
    st.markdown("Analyze and explore your Copilot CLI session logs with ease")
    
    viewer = JSONLViewer()
    
    # Sidebar for file upload and filters
    with st.sidebar:
        st.header("📁 Load Session Data")
        
        # Loading mode selection
        loading_mode = st.radio(
            "Loading Mode:",
            ["📁 Load Directory (Last 10)", "📄 Single File"],
            help="Choose to load the 10 most recent files from a directory or a single file"
        )
        
        if loading_mode == "📁 Load Directory (Last 10)":
            # Directory path input
            default_dir = viewer.find_default_directory()
            if default_dir:
                st.info(f"💡 **Default directory:**\n`{default_dir}`")
                
            directory_path = st.text_input(
                "Directory Path:",
                value=default_dir or "",
                help="Enter the path to directory containing JSONL files"
            )
            
            # Session limit control
            session_limit = st.slider(
                "Number of recent sessions to load:",
                min_value=1,
                max_value=50,
                value=10,
                help="Load the most recent N session files"
            )
            
            # Show current status if files are loaded
            if (st.session_state.get('loading_mode') == 'directory' and 
                'files_data' in st.session_state and 
                st.session_state.get('directory_path')):
                current_dir = st.session_state.get('directory_path')
                file_count = len(st.session_state.get('files_data', {}))
                session_limit = st.session_state.get('session_limit', 10)
                st.success(f"📂 Currently loaded: {file_count} of last {session_limit} sessions from `{current_dir}`")
            
            col1, col2 = st.columns(2)
            with col1:
                load_button = st.button(f"Load Last {session_limit} Sessions")
            with col2:
                reload_button = st.button("🔄 Reload", help="Reload files from the same directory")
                
            if (load_button and directory_path) or reload_button:
                # Use current directory for reload
                target_dir = directory_path if load_button else st.session_state.get('directory_path', '')
                current_limit = session_limit if load_button else st.session_state.get('session_limit', 10)
                
                if os.path.exists(target_dir):
                    try:
                        st.write(f"🔍 Debug: Target directory exists: {target_dir}")
                        
                        # Only load if we haven't already loaded this directory with same limit (or if reloading)
                        current_dir = st.session_state.get('directory_path')
                        current_session_limit = st.session_state.get('session_limit', 10)
                        
                        st.write(f"🔍 Debug: Current dir: {current_dir}, Target dir: {target_dir}")
                        st.write(f"🔍 Debug: Current limit: {current_session_limit}, Target limit: {current_limit}")
                        st.write(f"🔍 Debug: Reload button: {reload_button}")
                        
                        if (reload_button or current_dir != target_dir or 
                            current_session_limit != current_limit or 'files_data' not in st.session_state):
                            
                            st.write("🔍 Debug: Loading files from directory...")
                            files_data = viewer.load_files_from_directory(target_dir, current_limit)
                            
                            if files_data:
                                st.write(f"🔍 Debug: Files loaded successfully, analyzing relationships...")
                                # Analyze agent relationships
                                viewer.agent_relationships = viewer.analyze_agent_relationships(files_data)
                                
                                st.session_state['files_data'] = files_data
                                st.session_state['directory_path'] = target_dir
                                st.session_state['session_limit'] = current_limit
                                st.session_state['loading_mode'] = 'directory'
                                st.session_state['agent_relationships'] = viewer.agent_relationships
                                action = "Reloaded" if reload_button else "Loaded"
                                st.success(f"✅ {action} {len(files_data)} most recent session files!")
                                st.rerun()
                            else:
                                st.warning("No JSONL files found in the directory")
                        else:
                            st.info(f"Last {current_session_limit} sessions already loaded!")
                    except Exception as e:
                        st.error(f"Error loading directory: {e}")
                else:
                    st.error("Directory does not exist")
                    
        else:  # Single file mode
            # File uploader
            uploaded_file = st.file_uploader(
                "Choose a JSONL file", 
                type=['jsonl', 'json'],
                help="Upload your GitHub Copilot CLI session file"
            )
            
            if uploaded_file is not None:
                # Only process if we haven't already processed this file
                if ('filename' not in st.session_state or 
                    st.session_state.get('filename') != uploaded_file.name):
                    content = uploaded_file.getvalue().decode('utf-8')
                    st.session_state['file_content'] = content
                    st.session_state['filename'] = uploaded_file.name
                    st.session_state['loading_mode'] = 'single'
                    st.rerun()
    
    # Check if we have data to work with
    if 'file_content' not in st.session_state and 'files_data' not in st.session_state:
        st.info("👆 Please load JSONL session files using the sidebar")
        st.markdown("""
        ### Expected File Format
        The tool expects JSONL files from GitHub Copilot CLI sessions, typically found at:
        - **Windows:** `C:\\Users\\[username]\\.ghccli\\tmp\\sessions\\`
        - **macOS/Linux:** `~/.ghccli/tmp/sessions/`
        
        **Directory Mode**: Loads the most recent session files (default: last 10)
        **Session Selection**: Choose a session from the sidebar to view its interactions
        """)
        return
    
    # Load and process data
    try:
        if st.session_state.get('loading_mode') == 'directory' and 'files_data' in st.session_state:
            # Directory mode - show session selection
            files_data = st.session_state['files_data']
            
            if not files_data:
                st.error("No valid data found in the files")
                return
            
            # Add session selection to sidebar
            with st.sidebar:
                st.header("📋 Session Selection")
                
                # files_data is already in correct order (newest first) from load_files_from_directory
                sorted_files = list(files_data.keys())

                # Build / rebuild session groups if underlying file list changed
                if st.session_state.get('group_source_files') != sorted_files:
                    viewer.build_session_groups(files_data)
                    st.session_state['group_source_files'] = sorted_files
                    st.session_state['session_groups'] = viewer.session_groups

                # Toggle grouping UI
                enable_grouping = st.checkbox(
                    "Group by sessionId (correlate multi-file sessions)",
                    value=st.session_state.get('enable_grouping', True),
                    help="Group multiple log files that share the same sessionId (taken from filename suffix or embedded sessionId field)."
                )
                st.session_state['enable_grouping'] = enable_grouping

                # Show group list
                if enable_grouping and viewer.session_groups:
                    st.subheader("🔗 SessionId Groups")
                    # Prioritize groups with >1 file (likely parent+children)
                    group_items = list(viewer.session_groups.items())
                    group_items.sort(key=lambda kv: (-len(kv[1]), kv[0]))
                    for sid, files_in_group in group_items:
                        label = f"{sid[:8]}… ({len(files_in_group)} file{'s' if len(files_in_group)!=1 else ''})"
                        is_sel = st.session_state.get('selected_session_group') == sid
                        btn_type = "primary" if is_sel else "secondary"
                        if st.button(label, key=f"grp_{sid}", type=btn_type, use_container_width=True):
                            st.session_state['selected_session_group'] = sid
                            # Clear single session selection to avoid ambiguity
                            st.session_state.pop('selected_session', None)
                            st.rerun()
                        if is_sel:
                            st.caption("\n".join(files_in_group))
                    if st.session_state.get('selected_session_group'):
                        if st.button("Clear Group Selection", key="clear_session_group"):
                            st.session_state.pop('selected_session_group', None)
                            st.rerun()
                
                # Default to the most recent session if none selected
                if 'selected_session' not in st.session_state and sorted_files:
                    st.session_state['selected_session'] = sorted_files[0]
                
                # Display sessions as clickable list with hierarchy info
                st.subheader("Click to select a session:")
                
                # Group sessions by relationships
                agent_relationships = st.session_state.get('agent_relationships', {})
                viewer.agent_relationships = agent_relationships
                
                # Separate main agents and sub-agents
                main_agents = []
                sub_agents = []
                standard_sessions = []
                
                for filename in sorted_files:
                    hierarchy_info = viewer.get_agent_hierarchy_info(filename)
                    if hierarchy_info.get('has_agent_invocation'):
                        main_agents.append((filename, hierarchy_info))
                    elif hierarchy_info.get('is_sub_agent'):
                        sub_agents.append((filename, hierarchy_info))
                    else:
                        standard_sessions.append((filename, hierarchy_info))
                
                # Display sessions grouped by type
                session_counter = 1
                
                def display_session_group(sessions, group_title):
                    nonlocal session_counter
                    if sessions:
                        if group_title:
                            st.markdown(f"**{group_title}**")
                        
                        for filename, hierarchy_info in sessions:
                            file_data = files_data[filename]
                            is_selected = filename == st.session_state.get('selected_session')
                            
                            # Get file timestamp
                            file_path = os.path.join(st.session_state.get('directory_path', ''), filename)
                            time_str = ""
                            if os.path.exists(file_path):
                                mod_time = datetime.fromtimestamp(os.path.getmtime(file_path))
                                time_str = mod_time.strftime('%H:%M:%S')
                            
                            # Create display components
                            rank_text = "Most Recent" if session_counter == 1 else f"#{session_counter}"
                            type_display = hierarchy_info.get('type_display', '📄 Standard Session')
                            
                            # Show session as clickable button with hierarchy info
                            col1, col2 = st.columns([5, 1])
                            with col1:
                                button_type = "primary" if is_selected else "secondary"
                                button_text = f"{type_display.split()[0]} {filename}"
                                help_text = f"{rank_text} • {type_display} • {len(file_data)} interactions • {time_str}"
                                
                                # Add relationship info to help text
                                if hierarchy_info.get('children'):
                                    help_text += f" • Has {len(hierarchy_info['children'])} sub-agent(s)"
                                if hierarchy_info.get('parent'):
                                    help_text += f" • Child of {hierarchy_info['parent']}"
                                
                                if st.button(
                                    button_text,
                                    key=f"session_{session_counter}",
                                    help=help_text,
                                    type=button_type,
                                    use_container_width=True
                                ):
                                    st.session_state['selected_session'] = filename
                                    st.rerun()
                            
                            with col2:
                                st.caption(f"{len(file_data)}")
                            
                            # Show additional info for selected session
                            if is_selected:
                                st.success(f"🎯 **{rank_text}** • {time_str}")
                                if hierarchy_info.get('children'):
                                    child_names = ", ".join(hierarchy_info['children'])
                                    st.info(f"📋 Sub-agents: {child_names}")
                                if hierarchy_info.get('parent'):
                                    st.info(f"⬆️ Parent: {hierarchy_info['parent']}")
                            else:
                                info_text = f"{rank_text} • {time_str}"
                                if hierarchy_info.get('children'):
                                    info_text += f" • {len(hierarchy_info['children'])} child(s)"
                                st.caption(info_text)
                                
                            session_counter += 1
                
                # Display grouped sessions
                display_session_group(main_agents, "🔀 Main Agents (with Sub-agents)")
                display_session_group(sub_agents, "🤖 Sub-agents")
                display_session_group(standard_sessions, "📄 Standard Sessions")
                
                # Show total summary
                st.markdown("---")
                st.subheader("📊 Summary") 
                total_interactions = sum(len(data) for data in files_data.values())
                st.write(f"**Total**: {len(files_data)} sessions, {total_interactions} interactions")
            
            # Determine data source: grouped session or single file
            selected_group = (st.session_state.get('selected_session_group')
                               if st.session_state.get('enable_grouping') else None)
            if selected_group and selected_group in viewer.session_groups:
                group_files = viewer.session_groups[selected_group]
                combined = []
                for gf in group_files:
                    combined.extend(files_data.get(gf, []))
                try:
                    combined.sort(key=lambda item: item.get('timestamp') or '')
                except Exception:
                    pass
                data = combined
                st.success(f"✅ Viewing session group (sessionId={selected_group}) spanning {len(group_files)} file(s), {len(data)} interactions")
                st.info("📎 Grouping heuristic: files share identical sessionId (filename suffix or entry field). Order inferred from timestamp prefix & entry timestamps.")
            else:
                selected_session = st.session_state.get('selected_session')
                if selected_session and selected_session in files_data:
                    data = files_data[selected_session]
                    session_rank = list(files_data.keys()).index(selected_session) + 1
                    rank_text = " (Most Recent)" if session_rank == 1 else f" (#{session_rank} of {len(files_data)})"
                    hierarchy_info = viewer.get_agent_hierarchy_info(selected_session)
                    type_display = hierarchy_info.get('type_display', '📄 Standard Session')
                    st.success(f"✅ Viewing session: `{selected_session}`{rank_text} ({len(data)} interactions)")
                    st.info(f"📋 Session Type: {type_display}")
                    if hierarchy_info.get('children') or hierarchy_info.get('parent'):
                        st.markdown("### 🔗 Agent Relationships")
                        nav_cols = st.columns(3)
                        with nav_cols[0]:
                            if hierarchy_info.get('parent'):
                                parent_file = hierarchy_info['parent']
                                if st.button(f"⬆️ View Parent: {parent_file}", key="nav_parent"):
                                    st.session_state['selected_session'] = parent_file
                                    st.rerun()
                        with nav_cols[1]:
                            if hierarchy_info.get('children'):
                                st.markdown(f"**📋 Sub-agents ({len(hierarchy_info['children'])}):**")
                                for i, child_file in enumerate(hierarchy_info['children']):
                                    if st.button(f"🤖 {child_file}", key=f"nav_child_{i}"):
                                        st.session_state['selected_session'] = child_file
                                        st.rerun()
                        with nav_cols[2]:
                            if hierarchy_info.get('has_agent_invocation') and hierarchy_info.get('children'):
                                st.markdown("**📊 Hierarchy:**")
                                st.markdown(f"```\n{selected_session}\n" + "\n".join([f"├── {child}" for child in hierarchy_info['children']]) + "\n```")
                else:
                    st.error("No session selected or session not found")
                    return
                
        else:
            # Single file mode
            data = viewer.load_file(st.session_state['file_content'], st.session_state.get('filename', ''))
            if not data:
                st.error("No valid data found in the file")
                return
                
            st.success(f"✅ Loaded {len(data)} interactions from `{st.session_state.get('filename', 'uploaded file')}`")
        
    except Exception as e:
        st.error(f"Error processing data: {e}")
        return
    
    # Calculate and display stats
    stats = viewer.calculate_stats(data)
    
    col1, col2, col3, col4, col5 = st.columns(5)
    with col1:
        st.metric("Total Interactions", stats['total_interactions'])
    with col2:
        st.metric("Total Tokens", f"{stats['total_tokens']:,}")
    with col3:
        st.metric("Models Used", stats['unique_models'])
    with col4:
        st.metric("Session Duration", stats['session_duration'])
    with col5:
        st.metric("Avg Tokens/Interaction", stats['avg_tokens_per_interaction'])
    
    # Filters
    st.header("🔍 Filters & Options")
    
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        model_filter = st.selectbox(
            "Model Filter", 
            ["All Models"] + stats['models']
        )
    with col2:
        search_filter = st.text_input("Search in messages", placeholder="Enter search term...")
    with col3:
        min_tokens = st.number_input("Minimum tokens", min_value=0, value=0, step=100)
    with col4:
        show_incremental = st.checkbox("Show only incremental messages", value=True)
    
    # Apply filters
    filtered_data = viewer.filter_data(data, model_filter, search_filter, min_tokens)
    
    if not filtered_data:
        st.warning("No interactions match the current filters")
        return
        
    st.info(f"Showing {len(filtered_data)} of {len(data)} interactions")
    
    # Display interactions
    st.header("💬 Interactions")
    
    for i, item in enumerate(filtered_data):
        with st.expander(
            f"🔄 Interaction {item.get('interactionId', i+1)} - "
            f"{item.get('model', 'Unknown')} - "
            f"{datetime.fromisoformat(item['timestamp'].replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M:%S') if item.get('timestamp') else 'No timestamp'}"
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
            if item.get('request'):
                st.subheader("📤 Request")
                
                if show_incremental and item['request'].get('messages'):
                    session_id = next((d.get('sessionId') for d in data if d.get('sessionId')), 'unknown')
                    incremental_content = viewer.render_incremental_messages(
                        item['request']['messages'], 
                        session_id
                    )
                    if incremental_content.strip():
                        st.markdown(incremental_content)
                    else:
                        st.info("No new messages in this interaction")
                        
                    # Show full request in expander
                    with st.expander("Show Full Request"):
                        st.json(item['request'])
                else:
                    st.json(item['request'])
            
            # Response section
            if item.get('response'):
                st.subheader("📥 Response")
                st.json(item['response'])

if __name__ == "__main__":
    main()