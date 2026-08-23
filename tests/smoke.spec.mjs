// @ts-check
import { test, expect } from '@playwright/test';

test('app loads and shows setup view', async ({ page }) => {
  await page.goto('/app.html');
  // The #app container is rendered by JS into the static #app div
  await expect(page.locator('#app')).toBeAttached({ timeout: 5000 });
  // Setup mode shows the session length heading
  await expect(page.getByText('Session length')).toBeVisible();
});

test('session length stepper buttons respond to click', async ({ page }) => {
  await page.goto('/app.html');
  // Wait for stepper buttons to be present
  await page.waitForSelector('[data-act="incTarget"]');
  await page.waitForSelector('[data-act="decTarget"]');

  // The plus button should not have btn-disabled class initially
  const plusBtn = page.locator('[data-act="incTarget"]');
  await expect(plusBtn).not.toHaveClass(/btn-disabled/);

  // The span with the target text comes after the decTarget button
  const targetDisplay = page.locator('[data-act="decTarget"] + span');
  const initialText = await targetDisplay.textContent();
  await plusBtn.click();
  await page.waitForTimeout(100);
  const afterText = await targetDisplay.textContent();
  expect(afterText).not.toBe(initialText);
});

test.describe('setup controls', () => {
  test('start button is present when blocks exist', async ({ page }) => {
    await page.goto('/app.html');
    await page.waitForTimeout(500);
    // Look for start button by its text content
    const startBtn = page.getByText('Start');
    await expect(startBtn).toBeVisible();
  });
});