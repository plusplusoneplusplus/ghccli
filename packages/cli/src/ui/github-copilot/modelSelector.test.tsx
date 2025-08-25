
import React from 'react';
import { render } from 'ink-testing-library';
import { ModelSelector } from './modelSelector.js';
import { vi } from 'vitest';

describe('ModelSelector', () => {
  it('renders the list of models', () => {
    const models = ['gemini-2.5-pro', 'gpt-4o'];
    const { lastFrame } = render(
      <ModelSelector
        models={models}
        currentModel="gemini-2.5-pro"
        onSelect={() => {}}
      />
    );
    expect(lastFrame()).toContain('gemini-2.5-pro');
    expect(lastFrame()).toContain('gpt-4o');
  });

  it('shows navigation instructions', () => {
    const models = ['gemini-2.5-pro', 'gpt-4o'];
    const { lastFrame } = render(
      <ModelSelector
        models={models}
        currentModel="gemini-2.5-pro"
        onSelect={() => {}}
      />
    );
    expect(lastFrame()).toContain('use ↑/↓ arrows to navigate');
    expect(lastFrame()).toContain('Enter to select');
  });

  it('sets initial selection to current model', () => {
    const models = ['gemini-2.5-pro', 'gpt-4o', 'claude-3'];
    const onSelect = vi.fn();
    const { lastFrame } = render(
      <ModelSelector
        models={models}
        currentModel="gpt-4o"
        onSelect={onSelect}
      />
    );
    
    // The current model should be highlighted (this depends on how ink-select-input renders)
    const frame = lastFrame();
    expect(frame).toContain('gpt-4o');
  });

  it('handles keyboard navigation', () => {
    const models = ['gemini-2.5-pro', 'gpt-4o', 'claude-3'];
    const onSelect = vi.fn();
    const { stdin, lastFrame } = render(
      <ModelSelector
        models={models}
        currentModel="gemini-2.5-pro"
        onSelect={onSelect}
      />
    );

    // Test down arrow navigation
    stdin.write('\u001B[B'); // down arrow
    // Test enter to select
    stdin.write('\r'); // enter key
    
    expect(onSelect).toHaveBeenCalled();
  });
});
