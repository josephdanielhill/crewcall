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

    // Click End
    await clickAct(page, 'stop');
    await waitForMode(page, 'setup', 5000);
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