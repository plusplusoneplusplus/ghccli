# Multi-Chat Architecture Design

## Overview

This document outlines a simplified design for implementing multi-chat functionality in Gemini CLI, enabling users to run both background and foreground chat sessions concurrently. The design extends the existing `GeminiClient` directly rather than adding new abstraction layers, minimizing development time and complexity.

## Current Architecture

### Single Session Model
The current Gemini CLI architecture supports only one active chat session:

- **Single GeminiClient**: One client instance with one GeminiChat
- **Unified History**: Single conversation history managed in session state
- **Direct UI Binding**: React components directly connected to the single session
- **Synchronous Operation**: All interactions block the UI until completion

### Core Components
- `GeminiClient` (`packages/core/src/core/client.ts`): Manages API connections and chat sessions
- `GeminiChat` (`packages/core/src/core/geminiChat.ts`): Handles individual conversation state and API calls
- `SessionContext` (`packages/cli/src/ui/contexts/SessionContext.tsx`): Tracks session metrics and state
- `App.tsx` (`packages/cli/src/ui/App.tsx`): Main UI component orchestrating the single session

## Simplified Multi-Chat Design

### Core Principle: Extend GeminiClient Directly

Instead of creating new abstraction layers, we modify `GeminiClient` to manage multiple `GeminiChat` instances. This leverages the existing architecture while adding multi-chat capabilities with minimal changes.

### 1. Enhanced GeminiClient

```typescript
class GeminiClient {
  // Current single chat (maintained for backward compatibility)
  private chat?: GeminiChat;
  
  // NEW: Multi-chat support
  private chats: Map<string, GeminiChat> = new Map();
  private foregroundChatId?: string;
  private backgroundChats: Set<string> = new Set();
  private backgroundPromises: Map<string, Promise<Turn>> = new Map();
  
  // NEW: Chat management methods
  createChat(id?: string, type: 'foreground' | 'background' = 'foreground'): string {
    const chatId = id || generateChatId();
    const chat = await this.startChat();
    this.chats.set(chatId, chat);
    
    if (type === 'foreground') {
      this.foregroundChatId = chatId;
      this.chat = chat; // Maintain backward compatibility
    } else {
      this.backgroundChats.add(chatId);
    }
    
    return chatId;
  }
  
  switchToChat(chatId: string): void {
    const chat = this.chats.get(chatId);
    if (chat && !this.backgroundChats.has(chatId)) {
      this.foregroundChatId = chatId;
      this.chat = chat; // Update current chat for backward compatibility
    }
  }
  
  getCurrentChat(): GeminiChat {
    return this.getChat(); // Uses existing method
  }
  
  getChatById(chatId: string): GeminiChat | undefined {
    return this.chats.get(chatId);
  }
  
  listChats(): Array<{id: string, type: 'foreground' | 'background', status: string}> {
    return Array.from(this.chats.keys()).map(id => ({
      id,
      type: this.backgroundChats.has(id) ? 'background' : 'foreground',
      status: this.getBackgroundChatStatus(id)
    }));
  }
  
  deleteChat(chatId: string): void {
    this.chats.delete(chatId);
    this.backgroundChats.delete(chatId);
    this.backgroundPromises.delete(chatId);
    
    if (this.foregroundChatId === chatId) {
      this.foregroundChatId = undefined;
      this.chat = undefined;
    }
  }
  
  // NEW: Background chat methods
  async sendBackgroundMessage(
    chatId: string, 
    prompt: string, 
    signal?: AbortSignal
  ): Promise<void> {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    
    const promise = this.sendMessageToChat(chat, prompt, signal);
    this.backgroundPromises.set(chatId, promise);
    
    // Don't await - let it run in background
    promise.finally(() => {
      this.backgroundPromises.delete(chatId);
    });
  }
  
  getBackgroundChatStatus(chatId: string): 'idle' | 'running' | 'completed' | 'error' {
    if (!this.chats.has(chatId)) return 'completed';
    if (this.backgroundPromises.has(chatId)) return 'running';
    return 'idle';
  }
  
  async getBackgroundChatResult(chatId: string): Promise<Turn | null> {
    const promise = this.backgroundPromises.get(chatId);
    return promise ? await promise : null;
  }
  
  // NEW: Helper method to send message to specific chat
  private async sendMessageToChat(
    chat: GeminiChat, 
    prompt: string, 
    signal?: AbortSignal
  ): Promise<Turn> {
    // Temporarily switch context to target chat
    const originalChat = this.chat;
    this.chat = chat;
    
    try {
      // Use existing sendMessageStream logic but simplified
      const turn = new Turn(chat, generatePromptId());
      const request = [{ text: prompt }];
      const resultStream = turn.run(request, signal);
      
      // Consume stream without yielding to UI
      for await (const event of resultStream) {
        // Background processing - no UI updates
      }
      
      return turn;
    } finally {
      // Restore original chat
      this.chat = originalChat;
    }
  }
}
```

### 2. Minimal UI Changes

The UI components require minimal changes since they already work with `GeminiClient`:

```typescript
// Current usage (unchanged)
const client = config.getGeminiClient();
client.sendMessageStream(prompt, signal, promptId);

// NEW: Multi-chat usage
const chatId = client.createChat(undefined, 'foreground');
client.switchToChat(chatId);
client.sendMessageStream(prompt, signal, promptId); // Same API

// NEW: Background chat
const bgChatId = client.createChat(undefined, 'background');
client.sendBackgroundMessage(bgChatId, prompt);
```

### 3. Enhanced Slash Commands

Add new commands for multi-chat management:

```typescript
// Chat management
/chats                       // List all active chats
/chat new [name]            // Create new foreground chat
/chat switch <id>           // Switch to chat by ID
/chat delete <id>           // Delete a chat
/chat rename <id> <name>    // Rename a chat

// Background processing  
/bg <prompt>                // Start background task in new chat
/bg status                  // Show background chat status
/bg results <id>            // Get results from background chat
/bg kill <id>               // Cancel background chat
```

### 4. Concurrency Limits and Resource Management

#### Foreground Chat Limits
- **Active Foreground Chats**: 1 (only one receives user input at a time)
- **Total Foreground Chats**: 10 (can create multiple, switch between them)
- **UI Display**: Main conversation area shows only the currently active foreground chat

#### Background Chat Limits  
- **Concurrent Background Execution**: 3 (API rate limit protection)
- **Total Background Chats**: 5 (includes queued and completed)
- **Resource Management**: Background tasks share API quota with foreground

```typescript
class GeminiClient {
  private readonly MAX_FOREGROUND_CHATS = 10; // Can create many, but 1 active
  private readonly MAX_BACKGROUND_CHATS = 5;  // Total background chats
  private readonly MAX_CONCURRENT_BG = 3;     // Concurrent execution limit
  
  createChat(id?: string, type: 'foreground' | 'background' = 'foreground'): string {
    if (type === 'background' && this.backgroundChats.size >= this.MAX_BACKGROUND_CHATS) {
      throw new Error('Maximum background chats reached (5)');
    }
    if (type === 'foreground' && this.chats.size >= this.MAX_FOREGROUND_CHATS) {
      throw new Error('Maximum foreground chats reached (10)');
    }
    // ... create chat
  }
  
  async sendBackgroundMessage(chatId: string, prompt: string): Promise<void> {
    const runningCount = Array.from(this.backgroundPromises.keys()).length;
    if (runningCount >= this.MAX_CONCURRENT_BG) {
      throw new Error('Too many concurrent background tasks (max 3)');
    }
    // ... execute
  }
}
```

### 5. UI Display Design

#### Main Chat Area (Single Chat Focus)
The main conversation area shows only the currently active foreground chat:

```
┌─ Chat: work-project ─────────────────────────────────┐
│ User: How do I implement authentication?             │
│ Assistant: I'll help you implement authentication... │
│ ...                                                  │
│ [conversation continues]                             │
└─────────────────────────────────────────────────────┘
```

#### Status Bar (Compact Multi-Chat Overview)
Enhanced footer showing all chat activity at a glance:

```typescript
// Status bar display:
// [Chat: work-project] [FG: 3 total] [BG: 2 running, 1 completed] [gemini-2.5-pro]

interface ChatStatusProps {
  currentChatId: string
  foregroundChats: Array<{id: string}>
  backgroundChats: Array<{id: string, status: string}>
  client: GeminiClient
}

const ChatStatus: React.FC<ChatStatusProps> = ({ 
  currentChatId, 
  foregroundChats, 
  backgroundChats, 
  client 
}) => {
  const bgRunning = backgroundChats.filter(c => c.status === 'running').length;
  const bgCompleted = backgroundChats.filter(c => c.status === 'idle').length;
  const fgTotal = foregroundChats.length;
  
  return (
    <Text>
      [Chat: {currentChatId}] 
      {fgTotal > 1 && <Text> [FG: {fgTotal} total]</Text>}
      {backgroundChats.length > 0 && (
        <Text> [BG: {bgRunning} running, {bgCompleted} completed]</Text>
      )}
    </Text>
  );
};
```

#### Chat List Command (`/chats`)
Detailed view of all active chats:

```
┌─ Active Chats ──────────────────────────────────────┐
│ FOREGROUND:                                         │
│ → work-project    (active) - 12 messages           │
│   personal-help   (idle)   - 5 messages            │
│   debugging       (idle)   - 8 messages            │
│                                                     │
│ BACKGROUND:                                         │
│   bg-codebase     (running)   - analyzing...       │
│   bg-tests        (running)   - generating...      │
│   bg-docs         (completed) - 15 messages        │
│   bg-security     (error)     - failed after 3min │
└─────────────────────────────────────────────────────┘
```

#### Background Task Status (`/bg status`)
Real-time progress for background tasks:

```
┌─ Background Tasks ──────────────────────────────────┐
│ bg-codebase    [████████░░] 80% - analyzing files  │
│ bg-tests       [██░░░░░░░░] 20% - writing tests     │
│ bg-docs        [completed] - ready (/bg results)   │
│ bg-security    [error] - quota exceeded             │
└─────────────────────────────────────────────────────┘
```

### 6. Usage Scenarios

#### Light Usage (Typical Individual Developer)
- **Foreground**: 2-3 chats (switch between different projects/contexts)
- **Background**: 1-2 tasks (code analysis, documentation generation)
- **UI Impact**: Minimal status bar updates, main chat area stays clean

#### Heavy Usage (Power User)
- **Foreground**: 5-8 chats (multiple projects, different development phases)
- **Background**: 3-5 tasks (analysis, testing, research, code review)
- **UI Impact**: Rich status indicators, frequent use of `/chats` and `/bg status`

#### Enterprise Usage (Team Collaboration)
- **Foreground**: 8-10 chats (different team projects, client work)
- **Background**: 5+ tasks (CI/CD integration, bulk operations, monitoring)
- **UI Impact**: Heavy reliance on chat management commands and status monitoring

### 7. Configuration

Simple configuration additions to existing `Config` class:

```typescript
// Add to existing Config class
class Config {
  private maxForegroundChats: number = 10;
  private maxBackgroundChats: number = 5;
  private maxConcurrentBackgroundTasks: number = 3;
  private backgroundChatTimeout: number = 300000; // 5 minutes
  
  getMaxForegroundChats(): number { return this.maxForegroundChats; }
  setMaxForegroundChats(max: number): void { this.maxForegroundChats = max; }
  
  getMaxBackgroundChats(): number { return this.maxBackgroundChats; }
  setMaxBackgroundChats(max: number): void { this.maxBackgroundChats = max; }
  
  getMaxConcurrentBackgroundTasks(): number { return this.maxConcurrentBackgroundTasks; }
  setMaxConcurrentBackgroundTasks(max: number): void { this.maxConcurrentBackgroundTasks = max; }
  
  getBackgroundChatTimeout(): number { return this.backgroundChatTimeout; }
  setBackgroundChatTimeout(timeout: number): void { this.backgroundChatTimeout = timeout; }
}
```

## Implementation Strategy

### Simplified 3-Phase Approach (~3-5 days total)

#### Phase 1: Core Multi-Chat (2 days)
1. **Day 1**: Modify `GeminiClient` to support chat map and basic CRUD operations
   - Add `chats` Map and ID tracking
   - Implement `createChat()`, `switchToChat()`, `deleteChat()`
   - Maintain backward compatibility with existing `chat` property

2. **Day 2**: Add background chat execution  
   - Implement `sendBackgroundMessage()` and status tracking
   - Add `backgroundPromises` for async execution
   - Create `sendMessageToChat()` helper method

#### Phase 2: UI Integration (1-2 days)  
1. **Day 3**: Add slash commands
   - Implement `/chats`, `/chat new`, `/chat switch`, `/chat delete`
   - Add `/bg <prompt>`, `/bg status`, `/bg results` commands
   - Update command processor to handle new commands

2. **Day 4** (optional): Enhanced UI status
   - Add chat status indicator to footer
   - Show background task progress in status bar
   - Basic chat naming and identification

#### Phase 3: Polish (1 day)
1. **Day 5**: Testing and refinement
   - Error handling for edge cases
   - Resource cleanup and memory management  
   - Documentation and examples

## Key Benefits

### Development Benefits
- **4x Faster Implementation**: 3-5 days vs 15-20 days for session manager approach
- **Minimal Code Changes**: Extends existing `GeminiClient` rather than new abstractions
- **Backward Compatibility**: Existing API and workflows remain unchanged
- **Lower Risk**: Smaller surface area for bugs and regressions

### User Experience
- **Parallel Workflows**: Run background tasks while continuing foreground conversations
- **Simple Commands**: Intuitive `/bg` and `/chat` commands for multi-chat management
- **Non-Intrusive**: Background tasks don't interrupt the main UI flow
- **Immediate Value**: Basic multi-chat functionality available quickly

## Technical Considerations

### Resource Management
- **API Quota Sharing**: Background and foreground chats share the same API limits
- **Memory Efficiency**: Reuse existing `GeminiChat` instances rather than new abstractions
- **Simple Cleanup**: Background promises clean up automatically on completion

### Error Handling
- **Isolated Failures**: Background chat errors don't affect foreground operation
- **Timeout Protection**: Background chats have configurable timeouts
- **Graceful Degradation**: System continues working if background chats fail

## Migration Path

### Zero Breaking Changes
- **Existing API Preserved**: All current `GeminiClient` methods work unchanged
- **Opt-in Usage**: Multi-chat features only activate when explicitly used
- **Progressive Enhancement**: Users can adopt new features gradually

### Deployment Strategy
1. **Day 1**: Deploy with new methods available but unused
2. **Day 2**: Document new slash commands for early adopters
3. **Day 3**: Gather feedback and iterate based on real usage

## Future Extensions

Since this approach is simple and focused, it's easy to add advanced features later:

### Near-term Additions (if needed)
- **Chat Persistence**: Save/restore chat state across sessions
- **Chat Naming**: User-friendly names instead of generated IDs
- **Progress Notifications**: Real-time updates for long-running background tasks

### Advanced Features (future)
- **Cross-Chat Communication**: Reference results from one chat in another
- **Batch Operations**: Run the same prompt across multiple chats
- **Chat Templates**: Predefined chat configurations for specific use cases

## Conclusion

This simplified approach provides 80% of the multi-chat value with 25% of the implementation effort. By extending `GeminiClient` directly rather than creating new abstractions, we achieve:

- **Fast time-to-market**: Multi-chat functionality in 3-5 days
- **Low risk**: Minimal changes to proven architecture  
- **High value**: Enables parallel workflows immediately
- **Future flexibility**: Foundation for more advanced features if needed

The design prioritizes simplicity and pragmatism over theoretical perfection, making it ideal for rapid delivery of user-requested functionality.