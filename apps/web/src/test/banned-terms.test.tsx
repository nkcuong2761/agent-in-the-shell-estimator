import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App';
import { BANNED_TERMS } from '../copy';

/** Visible text of the page, leaving out the methods drawer (the one place technical terms may appear). */
function mainText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-methods], .sr-only').forEach((el) => el.remove());
  return clone.textContent ?? '';
}

function expectNoBannedTerms() {
  const text = mainText();
  for (const term of BANNED_TERMS) {
    // Acronyms match as whole uppercase words ("FTE" must not trip on "after"); phrases match anywhere, any case.
    const re = /^[A-Z0-9]+$/.test(term) ? new RegExp(`\\b${term}\\b`) : new RegExp(term, 'i');
    expect(re.test(text), `"${term}" appears on a main screen`).toBe(false);
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('plain language on the main screens', () => {
  it('a sample conversation shows no technical terms, with every stage expanded', async () => {
    window.location.hash = '#/estimate/sample-subscription-form';
    render(<App />);
    await screen.findByText('This will take about', {}, { timeout: 10000 });
    for (const row of screen.getAllByRole('button', { expanded: false })) fireEvent.click(row);
    await screen.findByText('Ask the client before you commit');
    expectNoBannedTerms();
  });

  it('the methods drawer is where the technical terms live', async () => {
    window.location.hash = '#/estimate/sample-investor-reminders';
    render(<App />);
    fireEvent.click(await screen.findByText('See the full working and methods', {}, { timeout: 10000 }));
    const drawer = document.querySelector('[data-methods]');
    expect(drawer?.textContent).toMatch(/P50|P80|buffer/i);
    expectNoBannedTerms();
  });

  it('a finished project shows no technical terms', async () => {
    window.location.hash = '#/project/P020';
    render(<App />);
    await screen.findByText('How did the estimate do?', {}, { timeout: 20000 });
    await screen.findByText(/Early estimates were off by about/);
    expectNoBannedTerms();
  }, 30000);

  it('the new estimate screen shows no technical terms', async () => {
    window.location.hash = '#/';
    render(<App />);
    await screen.findByText("What's the brief you'd like me to estimate?");
    expectNoBannedTerms();
  });
});
