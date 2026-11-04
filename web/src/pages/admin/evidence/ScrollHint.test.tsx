import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SCROLL_HINT, ScrollHint } from './ScrollHint';

describe('ScrollHint', () => {
  it('says to scroll sideways, and is hidden from md up', () => {
    render(<ScrollHint />);
    const el = screen.getByText('Scroll sideways to see all columns');
    expect(SCROLL_HINT).toBe('Scroll sideways to see all columns');
    expect(el.className).toMatch(/md:hidden/);
  });
});
