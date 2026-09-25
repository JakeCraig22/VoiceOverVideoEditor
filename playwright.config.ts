import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: 'msedge', launchOptions: { args: ['--use-fake-device-for-media-stream'] } },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
