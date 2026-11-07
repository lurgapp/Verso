import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname) && process.env.VERSO_ALLOW_EXTERNAL_E2E !== '1') {
  throw new Error('Publication E2E writes are restricted to loopback. Use an isolated test deployment; external runs require VERSO_ALLOW_EXTERNAL_E2E=1 and a dedicated test egress.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.PLAYWRIGHT_LOOPBACK_TLS === '1' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname),
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      args: [
        '--disable-quic',
        ...(process.env.PLAYWRIGHT_HOST_RESOLVER_RULES
          ? [`--host-resolver-rules=${process.env.PLAYWRIGHT_HOST_RESOLVER_RULES}`]
          : []),
      ],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? undefined : 'chrome',
    },
  }],
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev -- --port 3000',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
