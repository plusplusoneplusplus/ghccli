class JSONLViewer {
    constructor() {
        this.filesData = {};
        this.sessionGroups = {};
        this.selectedFile = null;
        this.selectedSessionId = null;
        this.incrementalMode = true; // Default to enabled
        this.lastMessages = {}; // Track previous messages for incremental view
        this.initializeDragAndDrop();
        this.showInitialInstructions();
        this.initializeIncrementalToggle();
    }

    async loadFiles() {
        const fileInput = document.getElementById('fileInput');
        const files = Array.from(fileInput.files);
        
        if (files.length === 0) {
            this.showMessage('Please select at least one JSONL file', 'warning');
            return;
        }

        this.filesData = {};
        this.sessionGroups = {};

        for (const file of files) {
            try {
                const content = await this.readFile(file);
                const data = this.parseJsonl(content, file.name);
                if (data.length > 0) {
                    this.filesData[file.name] = data;
                }
            } catch (error) {
                console.error(`Error loading ${file.name}:`, error);
                this.showMessage(`Error loading ${file.name}: ${error.message}`, 'error');
            }
        }

        this.buildSessionGroups();
        this.renderSessionGroups();
        this.updateSummary();
        this.updateReloadButton();
        this.showMessage(`Loaded ${Object.keys(this.filesData).length} session files`, 'info');
    }

    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    parseJsonl(content, filename) {
        const lines = content.trim().split('\n');
        const data = [];

        lines.forEach((line, index) => {
            if (line.trim()) {
                try {
                    const item = JSON.parse(line);
                    item._source_file = filename;
                    data.push(item);
                } catch (error) {
                    console.warn(`Skipping invalid JSON on line ${index + 1} in ${filename}: ${error.message}`);
                }
            }
        });

        return data;
    }

    extractSessionId(filename, data) {
        // First try to extract from data entries
        for (const item of data) {
            if (item.sessionId) {
                return item.sessionId;
            }
        }

        // Try filename pattern matching: yyyy_MM_dd_hh_mm_ss_<sessionId>.jsonl
        const match = filename.match(/^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_(.+)\.jsonl$/);
        if (match) {
            return match[1];
        }

        // Use filename without extension as session ID
        return filename.replace('.jsonl', '');
    }

    buildSessionGroups() {
        this.sessionGroups = {};
        
        for (const [filename, data] of Object.entries(this.filesData)) {
            const sessionId = this.extractSessionId(filename, data);
            if (!this.sessionGroups[sessionId]) {
                this.sessionGroups[sessionId] = [];
            }
            this.sessionGroups[sessionId].push(filename);
        }

        // Sort files within each group
        for (const sessionId of Object.keys(this.sessionGroups)) {
            this.sessionGroups[sessionId].sort();
        }
    }

    renderSessionGroups() {
        const container = document.getElementById('sessionGroups');
        container.innerHTML = '';

        if (Object.keys(this.sessionGroups).length === 0) {
            container.innerHTML = '<div class="no-data">No sessions found</div>';
            return;
        }

        for (const [sessionId, filenames] of Object.entries(this.sessionGroups)) {
            const totalInteractions = filenames.reduce((sum, filename) => {
                return sum + (this.filesData[filename]?.length || 0);
            }, 0);

            const sessionDiv = document.createElement('div');
            sessionDiv.className = 'session-group';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'session-header';
            headerDiv.onclick = () => this.toggleSessionGroup(sessionId);
            headerDiv.innerHTML = `
                <span>📂 ${sessionId.substring(0, 12)}... (${filenames.length} files)</span>
                <span class="chevron">▶</span>
            `;

            const filesDiv = document.createElement('div');
            filesDiv.className = 'session-files expanded';
            filesDiv.id = `session-${sessionId}`;
            
            let filesHtml = `<div style="margin-bottom: 12px; color: #8b949e;">Total interactions: ${totalInteractions}</div>`;
            
            filenames.forEach(filename => {
                const fileData = this.filesData[filename] || [];
                const isSelected = this.selectedFile === filename;
                filesHtml += `
                    <button class="button file-button ${isSelected ? 'primary' : 'secondary'}" 
                            onclick="viewer.selectFile('${filename}', '${sessionId}')">
                        📄 ${filename} (${fileData.length} interactions)
                    </button>
                `;
            });

            filesDiv.innerHTML = filesHtml;

            sessionDiv.appendChild(headerDiv);
            sessionDiv.appendChild(filesDiv);
            container.appendChild(sessionDiv);
        }
    }

    toggleSessionGroup(sessionId) {
        const filesDiv = document.getElementById(`session-${sessionId}`);
        const chevron = filesDiv.previousElementSibling.querySelector('.chevron');
        
        if (filesDiv.classList.contains('expanded')) {
            filesDiv.classList.remove('expanded');
            chevron.textContent = '▶';
        } else {
            filesDiv.classList.add('expanded');
            chevron.textContent = '▼';
        }
    }

    selectFile(filename, sessionId) {
        this.selectedFile = filename;
        this.selectedSessionId = sessionId;
        this.renderSessionGroups(); // Re-render to update selected state
        this.renderChatDetails(this.filesData[filename], filename);
        this.updateReloadButton();
    }

    toggleIncrementalView() {
        const toggle = document.getElementById('incrementalToggle');
        this.incrementalMode = toggle.checked;
        
        // If a file is selected, re-render with new mode
        if (this.selectedFile && this.filesData[this.selectedFile]) {
            this.renderChatDetails(this.filesData[this.selectedFile], this.selectedFile);
        }
    }

    getIncrementalMessages(data, filename) {
        if (!this.incrementalMode) {
            return data; // Return all data if not in incremental mode
        }

        const incrementalData = [];
        let previousMessages = [];

        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const currentMessages = item.request?.messages || [];
            
            // Get messages that are new compared to previous interaction
            let newMessages = currentMessages;
            if (i > 0 && previousMessages.length > 0) {
                newMessages = this.findNewMessages(currentMessages, previousMessages);
            }
            
            // Create incremental version of the interaction
            const incrementalItem = { ...item };
            if (incrementalItem.request && newMessages.length > 0) {
                incrementalItem.request = { ...incrementalItem.request };
                incrementalItem.request.messages = newMessages;
            } else if (incrementalItem.request) {
                // If no new messages, show a placeholder
                incrementalItem.request = { ...incrementalItem.request };
                incrementalItem.request.messages = [{
                    role: 'system',
                    content: '(No new messages - repeated content hidden)'
                }];
            }
            
            // Update previous messages for next comparison
            previousMessages = currentMessages;
            
            incrementalData.push(incrementalItem);
        }

        return incrementalData;
    }

    findNewMessages(currentMessages, previousMessages) {
        if (previousMessages.length === 0) {
            return currentMessages; // First interaction, all messages are new
        }

        // If current has fewer messages than previous, something is wrong - return all current
        if (currentMessages.length < previousMessages.length) {
            return currentMessages;
        }

        // If they have the same length, compare all messages
        if (currentMessages.length === previousMessages.length) {
            const allIdentical = currentMessages.every((msg, index) => {
                const prevMsg = previousMessages[index];
                return prevMsg && msg.content === prevMsg.content && msg.role === prevMsg.role;
            });
            
            if (allIdentical) {
                return []; // No new messages
            } else {
                // Some messages are different - return all current messages
                return currentMessages;
            }
        }

        // Current has more messages than previous
        // Check if all previous messages are identical at the beginning
        const previousArePrefix = previousMessages.every((prevMsg, index) => {
            const currentMsg = currentMessages[index];
            return currentMsg && currentMsg.content === prevMsg.content && currentMsg.role === prevMsg.role;
        });

        if (previousArePrefix) {
            // Previous messages are a prefix, return only the new messages at the end
            return currentMessages.slice(previousMessages.length);
        } else {
            // Previous messages don't match - return all current messages
            return currentMessages;
        }
    }

    renderChatDetails(data, sessionName) {
        const mainContent = document.getElementById('mainContent');
        
        if (!data || data.length === 0) {
            mainContent.innerHTML = '<div class="no-data">No interactions found in this session</div>';
            return;
        }

        // Apply incremental filtering if enabled
        const displayData = this.getIncrementalMessages(data, sessionName);
        const stats = this.calculateStats(data); // Use original data for stats
        
        let html = `
            <h2>💬 Chat Details: ${sessionName}${this.incrementalMode ? ' (Incremental View)' : ''}</h2>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.totalInteractions}</div>
                    <div class="stat-label">Total Interactions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalTokens.toLocaleString()}</div>
                    <div class="stat-label">Total Tokens</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.uniqueModels}</div>
                    <div class="stat-label">Models Used</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.sessionDuration}</div>
                    <div class="stat-label">Session Duration</div>
                </div>
            </div>
            
            <h3>Conversation Flow</h3>
        `;

        displayData.forEach((item, index) => {
            const timestamp = this.formatTimestamp(item.timestamp);
            const model = item.model || 'Unknown';
            
            html += `
                <div class="interaction">
                    <div class="interaction-header" onclick="viewer.toggleInteraction(${index})">
                        <span>🔄 Interaction ${index + 1} - ${model} - ${timestamp}</span>
                        <span class="chevron" id="chevron-${index}">▶</span>
                    </div>
                    <div class="interaction-content" id="interaction-${index}">
                        ${this.renderInteractionContent(item)}
                    </div>
                </div>
            `;
        });

        mainContent.innerHTML = html;
    }

    renderInteractionContent(item) {
        let html = '';

        // Debug info for empty interactions
        if (!item.request?.messages && !item.response?.choices && !item.tokenUsage) {
            html += '<div style="color: #8b949e; font-style: italic; padding: 12px;">No interaction data found. Raw item keys: ' + Object.keys(item).join(', ') + '</div>';
        }

        // Token usage
        if (item.tokenUsage) {
            const usage = item.tokenUsage;
            html += `
                <div class="token-stats">
                    <div class="token-stat">
                        <div style="font-weight: bold;">${usage.promptTokens || 0}</div>
                        <div>Prompt Tokens</div>
                    </div>
                    <div class="token-stat">
                        <div style="font-weight: bold;">${usage.completionTokens || 0}</div>
                        <div>Completion</div>
                    </div>
                    <div class="token-stat">
                        <div style="font-weight: bold;">${usage.totalTokens || 0}</div>
                        <div>Total</div>
                    </div>
                    ${usage.cachedTokens ? `
                        <div class="token-stat">
                            <div style="font-weight: bold;">${usage.cachedTokens}</div>
                            <div>Cached</div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        // Messages
        if (item.request?.messages) {
            html += '<div class="message-section"><h4>📤 Messages</h4>';
            item.request.messages.forEach(msg => {
                const role = (msg.role || 'unknown').toLowerCase();
                const content = msg.content || '';
                
                // Show empty content indicator
                const displayContent = content.trim() || '<em style="color: #8b949e;">(empty message)</em>';
                const isLong = content.length > 1000;
                const messageId = `msg-${Math.random().toString(36).substr(2, 9)}`;
                
                html += `
                    <div class="message">
                        <div class="message-role ${role}">
                            ${role.toUpperCase()}:
                            ${isLong ? `<button class="expand-btn" onclick="viewer.toggleMessageExpansion('${messageId}')">Expand</button>` : ''}
                        </div>
                        <div class="message-content ${isLong ? 'collapsible' : ''}" id="${messageId}">
                            ${content.trim() ? this.escapeHtml(content) : displayContent}
                        </div>
                        ${msg.tool_calls ? this.renderToolCalls(msg.tool_calls) : ''}
                        ${msg.tool_call_id ? this.renderToolResult(msg) : ''}
                    </div>
                `;
            });
            html += '</div>';
        }

        // Response
        if (item.response?.choices) {
            html += '<div class="message-section"><h4>📥 Response</h4>';
            item.response.choices.forEach(choice => {
                if (choice.message?.content) {
                    const content = choice.message.content;
                    const isLong = content.length > 1000;
                    const messageId = `msg-${Math.random().toString(36).substr(2, 9)}`;
                    
                    html += `
                        <div class="message">
                            <div class="message-role assistant">
                                ASSISTANT:
                                ${isLong ? `<button class="expand-btn" onclick="viewer.toggleMessageExpansion('${messageId}')">Expand</button>` : ''}
                            </div>
                            <div class="message-content ${isLong ? 'collapsible' : ''}" id="${messageId}">
                                ${this.escapeHtml(content)}
                            </div>
                        </div>
                    `;
                }
            });
            html += '</div>';
        }

        return html;
    }

    renderToolCalls(toolCalls) {
        let html = '<div style="margin-top: 8px;"><div class="tool-section"><h5>🔧 Tool Calls</h5>';
        
        toolCalls.forEach((toolCall, index) => {
            const functionName = toolCall.function?.name || 'Unknown';
            const toolId = toolCall.id || `tool-${index}`;
            const args = toolCall.function?.arguments;
            
            html += `
                <div class="tool-call">
                    <div class="tool-header">
                        <strong>🛠️ ${functionName}</strong>
                        <span class="tool-id">(ID: ${toolId})</span>
                    </div>
            `;
            
            // Show arguments if present
            if (args) {
                try {
                    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
                    html += `
                        <div class="tool-args">
                            <strong>Parameters:</strong>
                            <pre class="json-display">${JSON.stringify(parsedArgs, null, 2)}</pre>
                        </div>
                    `;
                } catch (error) {
                    html += `
                        <div class="tool-args">
                            <strong>Parameters (raw):</strong>
                            <pre class="json-display">${this.escapeHtml(String(args))}</pre>
                        </div>
                    `;
                }
            }
            
            html += '</div>';
        });
        
        html += '</div></div>';
        return html;
    }

    renderToolResult(msg) {
        if (!msg.tool_call_id) return '';
        
        const toolCallId = msg.tool_call_id;
        const content = msg.content || '';
        const isLong = content.length > 1000;
        const resultId = `result-${Math.random().toString(36).substr(2, 9)}`;
        
        let html = `
            <div class="tool-result">
                <div class="tool-result-header">
                    <strong>📋 Tool Result</strong>
                    <span class="tool-id">(for: ${toolCallId})</span>
                    ${isLong ? `<button class="expand-btn" onclick="viewer.toggleMessageExpansion('${resultId}')">Expand</button>` : ''}
                </div>
                <div class="tool-result-content ${isLong ? 'collapsible' : ''}" id="${resultId}">
        `;
        
        // Try to parse as JSON for better formatting
        try {
            const parsed = JSON.parse(content);
            html += `<pre class="json-display">${JSON.stringify(parsed, null, 2)}</pre>`;
        } catch (error) {
            // Not JSON, display as text
            html += `<pre class="tool-output">${this.escapeHtml(content)}</pre>`;
        }
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }

    toggleInteraction(index) {
        const content = document.getElementById(`interaction-${index}`);
        const chevron = document.getElementById(`chevron-${index}`);
        
        if (content.classList.contains('expanded')) {
            content.classList.remove('expanded');
            chevron.textContent = '▶';
        } else {
            content.classList.add('expanded');
            chevron.textContent = '▼';
        }
    }

    calculateStats(data) {
        const interactions = data.filter(item => item.tokenUsage);
        const totalTokens = interactions.reduce((sum, item) => {
            return sum + (item.tokenUsage?.totalTokens || 0);
        }, 0);

        const models = new Set(data.map(item => item.model).filter(Boolean));
        
        const timestamps = data
            .map(item => {
                if (item.timestamp) {
                    try {
                        return new Date(item.timestamp.replace('Z', ''));
                    } catch {
                        return null;
                    }
                }
                return null;
            })
            .filter(Boolean)
            .sort();

        let sessionDuration = 'N/A';
        if (timestamps.length > 1) {
            const duration = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000 / 60;
            sessionDuration = `${Math.round(duration)} min`;
        }

        return {
            totalInteractions: data.length,
            totalTokens,
            uniqueModels: models.size,
            sessionDuration
        };
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'No timestamp';
        try {
            const date = new Date(timestamp.replace('Z', ''));
            return date.toLocaleTimeString();
        } catch {
            return timestamp;
        }
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return this.escapeHtml(text);
        return this.escapeHtml(text.substring(0, maxLength)) + '...';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateSummary() {
        const summary = document.getElementById('sessionSummary');
        const totalFiles = Object.keys(this.filesData).length;
        const totalInteractions = Object.values(this.filesData)
            .reduce((sum, data) => sum + data.length, 0);
        
        summary.textContent = `📊 Total: ${totalFiles} files, ${totalInteractions} interactions`;
    }

    clearSessions() {
        this.filesData = {};
        this.sessionGroups = {};
        this.selectedFile = null;
        this.selectedSessionId = null;
        
        document.getElementById('sessionGroups').innerHTML = '';
        document.getElementById('sessionSummary').textContent = '';
        document.getElementById('mainContent').innerHTML = `
            <div class="no-data">
                <h3>👆 Load session files to get started</h3>
                <div style="margin-top: 20px;">
                    <h4>Expected File Format</h4>
                    <p>The tool expects JSONL files from GitHub Copilot CLI sessions.</p>
                </div>
            </div>
        `;
        document.getElementById('fileInput').value = '';
        this.updateReloadButton();
    }

    showMessage(message, type = 'info') {
        const existing = document.querySelector('.message-toast');
        if (existing) {
            existing.remove();
        }

        const toast = document.createElement('div');
        toast.className = `${type} message-toast`;
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.zIndex = '1000';
        toast.style.maxWidth = '400px';
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }

    initializeDragAndDrop() {
        const container = document.querySelector('.container');
        
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            container.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        // Highlight drop area when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            container.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            container.addEventListener(eventName, unhighlight, false);
        });

        // Handle dropped files
        container.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            this.handleDroppedFiles(files);
        }, false);

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        function highlight(e) {
            container.classList.add('drag-highlight');
        }

        function unhighlight(e) {
            container.classList.remove('drag-highlight');
        }
    }

    async handleDroppedFiles(files) {
        const jsonlFiles = Array.from(files).filter(file => 
            file.name.toLowerCase().endsWith('.jsonl')
        );

        if (jsonlFiles.length === 0) {
            this.showMessage('Please drop JSONL files only', 'warning');
            return;
        }

        this.filesData = {};
        this.sessionGroups = {};

        for (const file of jsonlFiles) {
            try {
                const content = await this.readFile(file);
                const data = this.parseJsonl(content, file.name);
                if (data.length > 0) {
                    this.filesData[file.name] = data;
                }
            } catch (error) {
                console.error(`Error loading ${file.name}:`, error);
                this.showMessage(`Error loading ${file.name}: ${error.message}`, 'error');
            }
        }

        this.buildSessionGroups();
        this.renderSessionGroups();
        this.updateSummary();
        this.updateReloadButton();
        this.showMessage(`Loaded ${Object.keys(this.filesData).length} session files`, 'info');
        
        // Clear the main content instructions
        const mainContent = document.getElementById('mainContent');
        if (mainContent.innerHTML.includes('Load session files to get started')) {
            mainContent.innerHTML = '<div class="no-data">👈 Select a session file from the sidebar to view chat details</div>';
        }
    }

    showInitialInstructions() {
        // Add enhanced instructions with drag and drop info
        const mainContent = document.getElementById('mainContent');
        const username = this.getCurrentUsername();
        const windowsPath = `C:\\Users\\${username}\\.ghccli\\tmp\\sessions\\`;
        
        mainContent.innerHTML = `
            <div class="no-data">
                <h3>📁 Load JSONL Session Files</h3>
                <div style="margin: 20px 0;">
                    <p><strong>Drag & Drop:</strong> Drop JSONL files anywhere on this page</p>
                    <p><strong>File Picker:</strong> Use the "Choose Files" button in the sidebar</p>
                </div>
                <div style="margin-top: 20px;">
                    <h4>Expected File Locations</h4>
                    <p>GitHub Copilot CLI sessions are typically found at:</p>
                    <ul style="margin-top: 12px; text-align: left; display: inline-block;">
                        <li><strong>Windows:</strong> ${windowsPath}</li>
                        <li><strong>macOS/Linux:</strong> ~/.ghccli/tmp/sessions/</li>
                    </ul>
                </div>
            </div>
        `;
    }

    toggleMessageExpansion(messageId) {
        const messageElement = document.getElementById(messageId);
        const isExpanded = messageElement.classList.contains('expanded');
        
        if (isExpanded) {
            messageElement.classList.remove('expanded');
            // Find the button and update text
            const button = messageElement.parentElement.querySelector('.expand-btn');
            if (button) button.textContent = 'Expand';
        } else {
            messageElement.classList.add('expanded');
            // Find the button and update text
            const button = messageElement.parentElement.querySelector('.expand-btn');
            if (button) button.textContent = 'Collapse';
        }
    }

    initializeIncrementalToggle() {
        // Set the checkbox to checked by default after DOM is ready
        setTimeout(() => {
            const toggle = document.getElementById('incrementalToggle');
            if (toggle) {
                toggle.checked = this.incrementalMode;
            }
        }, 0);
    }

    updateReloadButton() {
        const reloadButton = document.getElementById('reloadButton');
        if (reloadButton) {
            reloadButton.disabled = !this.selectedFile;
        }
    }

    reloadCurrentView() {
        if (this.selectedFile && this.filesData[this.selectedFile]) {
            this.renderChatDetails(this.filesData[this.selectedFile], this.selectedFile);
            this.showMessage('View reloaded', 'info');
        }
    }

    getCurrentUsername() {
        // Try to extract username from previously loaded file paths
        // This works if user has already loaded files from the sessions directory
        for (const filename of Object.keys(this.filesData)) {
            // Look for patterns like "C:\Users\john\.ghccli\" or similar
            const match = filename.match(/(?:Users[\\\/]([^\\\/]+)[\\\/]|home[\\\/]([^\\\/]+)[\\\/])/i);
            if (match) {
                return match[1] || match[2];
            }
        }
        
        // Fallback: return placeholder that user can understand
        return '[your-username]';
    }

    async loadDefaultSessions() {
        // For browser-based app, we can't directly access file system
        // But we can provide a button to select the default directory
        try {
            if ('showDirectoryPicker' in window) {
                // Show a message suggesting the default path before opening picker
                const platform = navigator.platform.toLowerCase();
                const isWindows = platform.includes('win');
                const username = this.getCurrentUsername();
                const defaultPath = isWindows 
                    ? `C:\\Users\\${username}\\.ghccli\\tmp\\sessions\\`
                    : `~/.ghccli/tmp/sessions/`;
                
                this.showMessage(`Please navigate to your sessions folder: ${defaultPath}`, 'info');
                
                const directoryHandle = await window.showDirectoryPicker({
                    id: 'ghccli-sessions',
                    mode: 'read'
                });
                const files = [];
                
                for await (const [name, fileHandle] of directoryHandle.entries()) {
                    if (fileHandle.kind === 'file' && name.toLowerCase().endsWith('.jsonl')) {
                        const file = await fileHandle.getFile();
                        files.push(file);
                    }
                }

                if (files.length > 0) {
                    // Sort files by modification time (newest first)
                    files.sort((a, b) => b.lastModified - a.lastModified);
                    
                    // Load only the most recent 10 files
                    const recentFiles = files.slice(0, 10);
                    
                    this.filesData = {};
                    this.sessionGroups = {};

                    for (const file of recentFiles) {
                        try {
                            const content = await this.readFile(file);
                            const data = this.parseJsonl(content, file.name);
                            if (data.length > 0) {
                                this.filesData[file.name] = data;
                            }
                        } catch (error) {
                            console.error(`Error loading ${file.name}:`, error);
                        }
                    }

                    this.buildSessionGroups();
                    this.renderSessionGroups();
                    this.updateSummary();
                    this.updateReloadButton();
                    this.showMessage(`Auto-loaded ${Object.keys(this.filesData).length} recent session files`, 'info');
                } else {
                    this.showMessage('No JSONL files found in selected directory', 'warning');
                }
            } else {
                this.showMessage('Directory picker not supported in this browser', 'warning');
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                this.showMessage('Error accessing directory: ' + error.message, 'error');
            }
        }
    }
}

// Initialize the viewer
const viewer = new JSONLViewer();

// Global functions for onclick handlers
function loadFiles() {
    viewer.loadFiles();
}

function clearSessions() {
    viewer.clearSessions();
}

function loadDefaultSessions() {
    viewer.loadDefaultSessions();
}

function toggleIncrementalView() {
    viewer.toggleIncrementalView();
}

function reloadCurrentView() {
    viewer.reloadCurrentView();
}