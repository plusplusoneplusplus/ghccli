/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { ModelDialog } from './ModelDialog.js';
import { vi } from 'vitest';

describe('ModelDialog', () => {
  const mockModels = ['gemini-2.5-pro', 'gpt-4o', 'claude-sonnet-4'];
  const mockOnExit = vi.fn();
  const mockOnModelSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the model dialog when open', () => {
    const { lastFrame } = render(
      <ModelDialog
        isOpen={true}
        onExit={mockOnExit}
        models={mockModels}
        currentModel="gemini-2.5-pro"
        onModelSelect={mockOnModelSelect}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain('Model Selection');
    expect(frame).toContain('Choose an AI model to use for your conversations');
    expect(frame).toContain('gemini-2.5-pro');
    expect(frame).toContain('gpt-4o');
    expect(frame).toContain('claude-sonnet-4');
  });

  it('does not render when closed', () => {
    const { lastFrame } = render(
      <ModelDialog
        isOpen={false}
        onExit={mockOnExit}
        models={mockModels}
        currentModel="gemini-2.5-pro"
        onModelSelect={mockOnModelSelect}
      />
    );

    expect(lastFrame()).toBe('');
  });

  it('shows keyboard navigation instructions', () => {
    const { lastFrame } = render(
      <ModelDialog
        isOpen={true}
        onExit={mockOnExit}
        models={mockModels}
        currentModel="gemini-2.5-pro"
        onModelSelect={mockOnModelSelect}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain('use ↑/↓ arrows to navigate');
    expect(frame).toContain('Enter to select');
  });
});
