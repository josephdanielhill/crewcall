// @ts-check
import { test, expect } from '@playwright/test';

const APP_URL = '/app.html';

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('app loads and shows setup view', async ({ page }) => {
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'setup');
  });

  test('session length stepper buttons respond to click', async ({ page }) => {
    const targetSpan = page.locator('[data-act="decTarget"] + span');
    const textBefore = await targetSpan.textContent();
    await page.click('[data-act="incTarget"]', { force: true });
    await expect(targetSpan).not.toHaveText(textBefore ?? '');
    await page.click('[data-act="decTarget"]', { force: true });
    await expect(targetSpan).toHaveText(textBefore ?? '');
  });

  test.describe('setup controls', () => {
    test('start button is present and clickable', async ({ page }) => {
      // The start button triggers the prep phase
      await expect(page.locator('[data-act="start"]')).toBeAttached();
      await page.click('[data-act="start"]', { force: true });
      await expect(page.locator('#app')).toHaveAttribute('data-mode', 'prep', { timeout: 3000 });
    });
  });
});