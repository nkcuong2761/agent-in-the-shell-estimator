import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    // "No buffer: the number is pure working time" is the one sentence allowed to say the word.
    const cleaned = term === 'buffer' ? text.replace(/No buffer: the number is pure working time\./g, '').replace(/Risks & buffer|risks & buffer|Buffer for the unknown|risks and buffer/g, '') : text;
    expect(re.test(cleaned), `"${term}" appears on a main screen`).toBe(false);
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('plain language on the main screens', () => {
  it('the estimate document renders its fixed order, each anchor once, with no technical terms', async () => {
    window.location.hash = '#/estimate/sample-subscription-form';
    render(<App />);
    await screen.findByText('Estimated effort', {}, { timeout: 10000 });
    for (const id of ['est-summary', 'est-team', 'est-hours', 'est-duration', 'est-stages', 'est-questions', 'est-brief']) {
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1);
    }
    const order = ['est-summary', 'est-stages', 'est-questions', 'est-brief'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Open every stage, the why panel and the forecast list, then check the words.
    fireEvent.click(screen.getByText('Why this estimate and confidence?'));
    for (const row of within(document.getElementById('est-stages')!).getAllByRole('button', { expanded: false })) fireEvent.click(row);
    await screen.findByText('Ask the client before you commit');
    expect(document.querySelector('.composer-dock')).toBeNull();
    expect(screen.getByRole('button', { name: /Open the assistant/ })).toBeTruthy();
    expectNoBannedTerms();
    expect(mainText()).not.toMatch(/½/);
  });

  it('half values are written 16,5 in the header and editing the team updates the card in place', async () => {
    window.location.hash = '#/estimate/sample-fund-admin-sync';
    render(<App />);
    await screen.findByText('Estimated effort', {}, { timeout: 10000 });
    const duration = document.getElementById('est-duration')!;
    expect(duration.textContent).toMatch(/\d+(,5)?weeks|a fewdays/);
    const before = document.querySelectorAll('#est-summary').length;
    const inc = screen.getAllByRole('button', { name: /Increase Developer/ })[0]!;
    fireEvent.click(inc);
    await screen.findByText(/Updated: 1,5 developers, one part-time on the team\./);
    expect(document.querySelectorAll('#est-summary')).toHaveLength(before);
    expect(screen.getAllByText(/Updated:/).length).toBe(1);
  });

  it('the methods drawer is where the technical terms live', async () => {
    window.location.hash = '#/estimate/sample-investor-reminders';
    render(<App />);
    fireEvent.click(await screen.findByText('Why this estimate and confidence?', {}, { timeout: 10000 }));
    fireEvent.click(await screen.findByText('See the full working and methods'));
    const drawer = document.querySelector('[data-methods]');
    expect(drawer?.textContent).toMatch(/P50|P80|buffer/i);
    expectNoBannedTerms();
  });

  it('a finished project shows its category and no technical terms', async () => {
    window.location.hash = '#/project/P020';
    render(<App />);
    await screen.findByText('How did the estimate do?', {}, { timeout: 20000 });
    await screen.findByText(/Early estimates were off by about/);
    expect(screen.getAllByText(/^(New feature|Form|Integration|Data migration|Reporting)$/).length).toBeGreaterThan(0);
    expectNoBannedTerms();
  }, 30000);

  it('home shows the estimates table; #/new shows the brief screen', async () => {
    window.location.hash = '#/';
    render(<App />);
    await screen.findByText('Open estimates');
    expect(screen.getByRole('tab', { name: /Finished/ })).toBeTruthy();
    expect(screen.getByText('Export CSV')).toBeTruthy();
    expectNoBannedTerms();
    cleanup();
    window.location.hash = '#/new';
    render(<App />);
    await screen.findByText("What's the brief you'd like me to estimate?");
    expectNoBannedTerms();
  });

  it('the sidebar lists ongoing estimates with a progress line and no finished projects', async () => {
    window.location.hash = '#/';
    render(<App />);
    await screen.findByText('Open estimates');
    const nav = screen.getByRole('complementary', { name: 'Navigation' });
    expect(within(nav).getByText('Ongoing')).toBeTruthy();
    expect(within(nav).getAllByText(/Not started · starts|Week \d+ of \d+|Past the planned finish/).length).toBeGreaterThan(0);
    expect(within(nav).queryByText(/Sample data/)).toBeNull();
  });
});
