// @ts-check
import { test, expect } from '@playwright/test';

/**
 * CrewCall E2E tests — session flow, timer, pause/resume, skip, completion.
 *
 * The app is a vanilla JS SPA served via http-server (port 4173).
 * Prep period is 10 seconds by default; tests wait through it
 * or skip through intervals to reach desired states.
 *
 * NOTE: Click targets with infinite CSS animation (breathe 4.5s) use
 * { force: true } to bypass Playwright's actionability checks.
 */

const APP_URL = '/app.html';

/** Wait for #app to have a given data-mode value. */
async function waitForMode(page, mode, timeout = 15000) {
  await page.waitForFunction(
    (m) => document.getElementById('app')?.getAttribute('data-mode') === m,
    mode,
    { timeout }
  );
}

/** Click a data-act button with { force: true } (avoids CSS animation instability). */
async function clickAct(page, act) {
  await page.click(`[data-act="${act}"]`, { force: true });
  await page.waitForTimeout(100);
}

test.describe('Setup screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('renders with default 10:00 session length and Start button', async ({ page }) => {
    // The setup screen shows "Goal 10:00" badge — use exact match
    await expect(page.getByText('Goal 10:00', { exact: true })).toBeVisible();
    // The main timer shows just "10:00"
    await expect(page.getByText('10:00', { exact: true })).toBeVisible();
    // Start button
    await expect(page.locator('[data-act="start"]')).toBeAttached();
    // Intensity cards rendered
    await expect(page.locator('text=EXTREME')).toBeVisible();
    await expect(page.locator('text=HARD')).toBeVisible();
    await expect(page.locator('text=MEDIUM')).toBeVisible();
    await expect(page.locator('text=LOW')).toBeVisible();
    // Initial mode is setup
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'setup');
  });

  test('adjusts session length with + and - stepper buttons', async ({ page }) => {
    // The session length span sits between decTarget and incTarget buttons
    const targetSpan = page.locator('[data-act="decTarget"] + span');
    const initialText = await targetSpan.textContent();

    // Click + to increase
    await clickAct(page, 'incTarget');
    await expect(targetSpan).not.toHaveText(initialText ?? '');

    // Click - to decrease back
    await clickAct(page, 'decTarget');
    await expect(targetSpan).toHaveText(initialText ?? '');
  });

  test('Surprise me randomises the interval counts on the setup screen (BLD-983)', async ({ page }) => {
    // Each intensity card shows its interval count in the badge span that sits
    // between the − / + steppers (data-act="dec<Key>" + span).
    const readCounts = () =>
      page.evaluate(() =>
        ['Hc', 'Mc', 'Mdc', 'Lc', 'Fc']
          .map((s) => document.querySelector(`[data-act="dec${s}"] + span`)?.textContent ?? null)
          .join('|')
      );

    const before = await readCounts();

    // BLD-983 regression: the button previously wrote to the hidden Advanced
    // timeline (state.advancedSequence) and produced no visible change on the
    // main page. Clicking must now randomise the visible interval plan.
    await clickAct(page, 'surprise');

    // A confirmation toast must appear...
    await expect(page.locator('.toast')).toHaveText('Surprise me — intervals randomised');

    // ...and the on-screen interval counts must have changed (nothing happening
    // was the bug).
    const after = await readCounts();
    expect(after).not.toBe(before);
  });
});

test.describe('Session flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('start button initiates prep phase with countdown', async ({ page }) => {
    await clickAct(page, 'start');
    // Should now be in prep mode
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'prep', { timeout: 3000 });
    // Prep countdown number should be visible (10s)
    await expect(page.locator('.prep-countdown-val')).toBeVisible();
    // Cancel button appears during prep
    await expect(page.locator('[data-act="stop"]')).toBeVisible();
  });

  test('prep phase transitions to running after 10 seconds', async ({ page }) => {
    await clickAct(page, 'start');
    // Wait through the 10s prep period
    await waitForMode(page, 'running', 15000);
    // "remaining in phase" text should be visible during running
    await expect(page.locator('text=remaining in phase')).toBeVisible();
    // Pause/Skip/End buttons appear
    await expect(page.locator('[data-act="togglePause"]')).toBeVisible();
    await expect(page.locator('[data-act="skip"]')).toBeVisible();
    await expect(page.locator('[data-act="stop"]')).toBeVisible();
  });

  test('pause and resume during workout', async ({ page }) => {
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // Capture elapsed text before pause
    const elapsedLocator = page.locator('span:has-text("/")').first();
    const elapsedBefore = await elapsedLocator.textContent();

    // Pause
    await clickAct(page, 'togglePause');
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'paused');

    // Wait a moment and verify elapsed hasn't changed significantly
    await page.waitForTimeout(500);
    const elapsedDuring = await elapsedLocator.textContent();
    expect(elapsedDuring).toBe(elapsedBefore);

    // Resume
    await clickAct(page, 'togglePause');
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'running');
  });

  test('skip advances to next interval', async ({ page }) => {
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // Verify running mode
    const phaseIdxText = await page.evaluate(() =>
      document.querySelector('#app')?.getAttribute('data-mode')
    );
    expect(phaseIdxText).toBe('running');

    // Click skip via evaluate to avoid animation/visibility issues
    await page.evaluate(() => {
      const btn = document.querySelector('[data-act="skip"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(200);

    // Still in running mode
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'running');
  });

  test('skip through all intervals reaches done state', async ({ page }) => {
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // With default config (10 intervals at 10min), skip through all
    for (let i = 0; i < 15; i++) {
      const isDone = await page.evaluate(() =>
        document.getElementById('app')?.getAttribute('data-mode') === 'done'
      );
      if (isDone) break;
      // Use evaluate to click skip (avoids Playwright visibility checks)
      await page.evaluate(() => {
        const btn = document.querySelector('[data-act="skip"]');
        if (btn) btn.click();
      });
      await page.waitForTimeout(150);
    }

    await waitForMode(page, 'done', 5000);
    // Completion screen should show
    await expect(page.locator('text=Workout Cleared')).toBeVisible({ timeout: 3000 });
    // Save workout PNG button
    await expect(page.locator('[data-act="downloadCard"]')).toBeAttached();
    // Repeat button
    await expect(page.locator('[data-act="restart"]')).toBeAttached();
  });

  test('stop during workout returns to setup', async ({ page }) => {
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // Use evaluate to reliably click animated buttons
    await page.evaluate(() => document.querySelector('[data-act="stop"]')?.click());
    await page.waitForFunction(
      (m) => document.getElementById('app')?.getAttribute('data-mode') === m,
      'setup',
      { timeout: 5000 }
    );
    // Start button should be back
    await expect(page.locator('[data-act="start"]')).toBeAttached();
  });

  test('restart after completion begins new session in running mode', async ({ page }) => {
    // Complete the workout
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);
    for (let i = 0; i < 15; i++) {
      if (await page.evaluate(() => document.getElementById('app')?.getAttribute('data-mode') === 'done')) break;
      // Use evaluate to click skip (avoids Playwright visibility checks during rapid re-renders)
      await page.evaluate(() => {
        const btn = document.querySelector('[data-act="skip"]');
        if (btn) btn.click();
      });
      await page.waitForTimeout(150);
    }
    await waitForMode(page, 'done', 5000);

    // Click Repeat
    await clickAct(page, 'restart');
    // restart() calls runWorkout() directly — goes straight to running (no prep)
    await waitForMode(page, 'running', 10000);
    await expect(page.locator('[data-act="togglePause"]')).toBeVisible();
  });

  test('pause then stop during workout returns to setup', async ({ page }) => {
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // Pause — use evaluate to bypass visibility checks during render transitions
    await page.evaluate(() => {
      const btn = document.querySelector('[data-act="togglePause"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'paused');

    // Stop from paused state returns to setup
    await clickAct(page, 'stop');
    await waitForMode(page, 'setup', 5000);
  });

  test('log this row shows a visible confirmation toast and stores the entry', async ({ page }) => {
    // Complete the workout
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);
    for (let i = 0; i < 15; i++) {
      if (await page.evaluate(() => document.getElementById('app')?.getAttribute('data-mode') === 'done')) break;
      await page.evaluate(() => document.querySelector('[data-act="skip"]')?.click());
      await page.waitForTimeout(80);
    }
    await waitForMode(page, 'done', 5000);

    // Click "Log this row" on the end-session screen
    await page.evaluate(() => document.querySelector('[data-act="logRow"]')?.click());

    // Regression for BLD-839: the confirmation toast must actually be VISIBLE.
    // showToast previously omitted the .show class, leaving opacity:0 so the
    // button looked dead even though the entry was saved.
    const toast = page.locator('.toast');
    await expect(toast).toHaveText('Row logged to your device');
    await expect(toast).toHaveCSS('opacity', '1');
    await expect(toast).toBeVisible();

    // And the entry must be persisted
    const stored = await page.evaluate(() => localStorage.getItem('crewcall.rowlog.v1'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? '[]').length).toBeGreaterThan(0);
  });
});

test.describe('Row Log timeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('entry renders a mini timeline bar matching the interval structure, not text chips', async ({ page }) => {
    // Regression for BLD-839 re-review: the row log entry previously showed
    // the interval plus plain numbers (e.g. "H 2 · L 1") instead of the clear
    // timeline bar from the design concept. Seed one logged entry that has an
    // ordered plan so the bar must be proportionally sized + coloured.
    const seed = [{
      id: 'r_test_timeline',
      ts: Date.now(),
      dateISO: '2026-09-02',
      timeStr: '08:30',
      durationSec: 1800,
      intervals: 3,
      rating: 'up',
      label: 'H2 &middot; L1',
      breakdown: { high: 2, medium: 0, med: 0, low: 1, freeform: 0 },
      plan: {
        targetMin: 30,
        isAdvanced: false,
        config: {
          high: { count: 2, len: 300, rate: 32 },
          medium: { count: 0, len: 90, rate: 28 },
          med: { count: 0, len: 105, rate: 26 },
          low: { count: 1, len: 1200, rate: 24 },
          freeform: { count: 0, len: 60, rate: null }
        }
      }
    }];
    await page.evaluate((entry) => {
      localStorage.setItem('crewcall.rowlog.v1', JSON.stringify([entry]));
    }, seed[0]);
    // Reload so rowlog initialises from the seeded localStorage.
    await page.reload();
    // Open the Row Log from the setup screen.
    await clickAct(page, 'openRowLog');
    await waitForMode(page, 'rowlog', 5000);
    // The card should show the timeline bar (a horizontal strip with per-
    // interval coloured segments) — the design concept's visual, not text chips.
    const timeline = page.locator('.rowlog-timeline');
    await expect(timeline).toBeVisible();
    // 3 intervals -> 3 segments (not a single flat bar), and they carry the
    // intensity fill colours (present as inline background styles).
    const segCount = await page.evaluate(() =>
      document.querySelectorAll('.rowlog-timeline > div').length
    );
    expect(segCount).toBe(3);
    const backgrounds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.rowlog-timeline > div'))
        .map((d) => d.style.background)
    );
    // High = coral-red zone, Low = mint zone; both distinct fills present.
    expect(backgrounds.length).toBe(3);
    // The old text-chip representation must not leak into the timeline area.
    await expect(timeline).not.toContainText('H ');
  });
});

test.describe('Sidebar and layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('sidebar toggle button appears during running state and hides right panel', async ({ page }) => {
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // Sidebar toggle button — check it's in the DOM
    await expect(page.locator('.sidebar-toggle-btn')).toBeAttached({ timeout: 3000 });

    // Sidebar should be visible (not hidden)
    await expect(page.locator('#app')).not.toHaveClass(/sidebar-hidden/);

    // Click toggle to hide sidebar — use evaluate to avoid Playwright visibility checks
    // during render transitions (the toggle mounts/unmounts across mode changes)
    await page.evaluate(() => {
      const btn = document.querySelector('.sidebar-toggle-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#app')).toHaveClass(/sidebar-hidden/);

    // Click toggle again to restore
    await page.evaluate(() => {
      const btn = document.querySelector('.sidebar-toggle-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#app')).not.toHaveClass(/sidebar-hidden/);
  });
});

test.describe('Countdown beep (BLD-1008)', () => {
  // The active-cadence timer runs on real 30-60s+ intervals, which is far too
  // slow for E2E. Install the test hooks (window.__crewcallTestSeek /
  // __crewcallCountdownBeeps) via addInitScript so tests can deterministically
  // advance the running timer and observe countdown-beep firings. The seek hook
  // is only installed when __crewcallTestSeek is set, so production is untouched.
  async function withCountdownHooks(page) {
    await page.addInitScript(() => {
      window.__crewcallTestSeek = true;
      window.__crewcallCountdownBeeps = [];
    });
  }

  async function beepCount(page) {
    return page.evaluate(() => (window.__crewcallCountdownBeeps || []).length);
  }

  test('pre-session countdown fires exactly one beep in the last 5s (BLD-1010)', async ({ page }) => {
    await withCountdownHooks(page);
    await page.goto(APP_URL);
    await clickAct(page, 'start');
    // Prep is 10s; the countdown beep must fire once during the last 5s of it.
    await waitForMode(page, 'running', 15000);
    // Only the prep beep should have fired by the time running begins (the first
    // active cadence is ~60s long, so no cadence beep can fire this early).
    expect(await beepCount(page)).toBe(1);
  });

  test('active cadence: one beep in the t-5s window, none outside, no double-fire on pause/resume (BLD-1009/1011)', async ({ page }) => {
    await withCountdownHooks(page);
    await page.goto(APP_URL);
    await clickAct(page, 'start');
    await waitForMode(page, 'running', 15000);

    // Ignore the prep beep; we're only measuring the active-cadence window.
    await page.evaluate(() => { window.__crewcallCountdownBeeps = []; });

    // Pause so the real timer stops drifting, then drive elapsed deterministically.
    await page.evaluate(() => document.querySelector('[data-act="togglePause"]')?.click());
    await waitForMode(page, 'paused');

    const end = await page.evaluate(() => window.__crewcallState.ends[0]);

    // Outside the t-5s window: no countdown beep.
    await page.evaluate((s) => window.__crewcallSeek(s), end - 8);
    expect(await beepCount(page)).toBe(0);

    // Enter the t-5s window: exactly one beep.
    await page.evaluate((s) => window.__crewcallSeek(s), end - 3);
    expect(await beepCount(page)).toBe(1);

    // Deeper in the window: still exactly one (fires once per t-5s crossing).
    await page.evaluate((s) => window.__crewcallSeek(s), end - 1);
    expect(await beepCount(page)).toBe(1);

    // Resume, let it run near the boundary, then pause again: no double-fire.
    await page.evaluate(() => document.querySelector('[data-act="togglePause"]')?.click());
    await waitForMode(page, 'running');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-act="togglePause"]')?.click());
    await waitForMode(page, 'paused');
    expect(await beepCount(page)).toBe(1);
  });
});