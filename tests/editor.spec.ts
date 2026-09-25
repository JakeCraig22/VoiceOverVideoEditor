import { test, expect, type Page } from '@playwright/test';

async function importVideo(page: Page) {
  // Generate real decodable media locally; no network fixture or microphone needed.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    const finished = new Promise<Blob>(resolve => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.start();
    const timer = setInterval(() => { ctx.fillStyle = '#527147'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = 'white'; ctx.fillText(`Local test ${Date.now()}`, 20, 80); }, 40);
    await new Promise(resolve => setTimeout(resolve, 2400)); recorder.stop(); clearInterval(timer);
    const blob = await finished; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  // MediaRecorder WebM lacks a duration header. Add finite duration using the last cluster timestamp via a local fixture utility.
  const { fixWebmDuration } = await import('@fix-webm-duration/fix');
  const fixed = await fixWebmDuration(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }), 2400);
  await page.getByLabel('Import reference video').setInputFiles({ name: 'reference.webm', mimeType: 'video/webm', buffer: Buffer.from(await fixed.arrayBuffer()) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
}

test('real video import, playback, seek, non-destructive trim and reset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await importVideo(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('#start-number').fill('0.5');
  await page.locator('#end-number').fill('1.5');
  await expect(page.getByTestId('scene-duration')).toHaveText('00:01.0');
  await page.getByLabel('Seek video').fill('0');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(0.5, 1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.5, 1);
  await page.getByRole('button', { name: 'Reset trim' }).click();
  await expect(page.locator('#start-number')).toHaveValue('0');
  const sourceDuration = await page.locator('video').evaluate((v: HTMLVideoElement) => v.duration);
  await expect(page.locator('#end-number')).toHaveValue(String(Number(sourceDuration.toFixed(3))));
  await page.getByLabel('Trim start marker').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#start-number')).toHaveValue('0.01');
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByText('No video selected')).toBeVisible();
});

test('phone layout, touch seek, invalid file and corrupt media errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Import reference video').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toContainText('Choose a non-empty video');
  await importVideo(page);
  await page.getByLabel('Seek video').click({ position: { x: 150, y: 25 } });
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.5);
  await page.screenshot({ path: 'test-results/phone.png', fullPage: true });
  await page.getByLabel('Import reference video').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('invalid video') });
  await expect(page.getByRole('alert')).toContainText('could not read the video');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});

test('record multiple real encoded takes, review with video, pause and seek stop recording', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const original = AudioBufferSourceNode.prototype.start;
    (window as any).audioStarts = [];
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
      (window as any).audioStarts.push({ offset: args[1], video: document.querySelector('video')?.currentTime, duration: this.buffer?.duration, peak: this.buffer ? Math.max(...this.buffer.getChannelData(0).slice(0, 10000).map(Math.abs)) : 0 });
      return original.apply(this, args);
    };
  });
  await page.goto('/'); await importVideo(page);
  await page.getByLabel('Seek video').fill('0.4');
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('button', { name: '■ Stop recording' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Take 1', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play Take 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).audioStarts.length)).toBeGreaterThan(0);
  const playback = await page.evaluate(() => (window as any).audioStarts[0]);
  expect(playback.video - playback.offset).toBeGreaterThanOrEqual(0.39);
  expect(playback.video - playback.offset).toBeLessThan(0.6);
  expect(playback.peak).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Seek video').fill('0.5');
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('button', { name: '■ Stop recording' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.2);
  await page.getByLabel('Seek video').fill('0.2');
  await expect(page.getByRole('button', { name: 'Play Take 2', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play Take 1', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/recording-phone.png', fullPage: true });
});

test('trim end finishes recording and microphone disconnection retains partial take', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { const stream = await get(c); (window as any).mic = stream; return stream; };
  });
  await page.goto('/'); await importVideo(page);
  await page.locator('#end-number').fill('1');
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Take 1', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).mic.getTracks()[0].readyState)).toBe('ended');
  await page.getByRole('button', { name: 'Reset trim' }).click();
  await page.getByLabel('Seek video').fill('0');
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('button', { name: '■ Stop recording' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.6);
  await page.evaluate(() => (window as any).mic.getTracks()[0].dispatchEvent(new Event('ended')));
  await expect(page.getByRole('button', { name: 'Play Take 2', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('Microphone disconnected');
});

test('permission denial is actionable and pending permission can be cancelled', async ({ page }) => {
  await page.goto('/'); await importVideo(page);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone permission denied');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); });
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Waiting for microphone');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: '● Record', exact: true })).toBeEnabled();
});

test('manual stop retains audio with an alternative supported format', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.goto('/'); await importVideo(page);
  await page.evaluate(() => {
    const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    MediaRecorder.isTypeSupported = type => type === 'audio/webm' && supported(type);
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (slice) { (window as any).chosenFormat = this.mimeType; start.call(this, slice); };
  });
  await page.getByRole('button', { name: '● Record', exact: true }).click();
  await expect(page.getByRole('button', { name: '■ Stop recording' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.7);
  await page.getByRole('button', { name: '■ Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Play Take 1', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).chosenFormat)).toBe('audio/webm');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
