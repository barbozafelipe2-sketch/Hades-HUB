import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'test/browser',testMatch:'*.spec.mjs',workers:1,fullyParallel:false,timeout:30000,
  use:{baseURL:'http://127.0.0.1:8787',headless:true,trace:'retain-on-failure',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
  webServer:{command:'node test/browser/server.mjs',url:'http://127.0.0.1:8787',reuseExistingServer:false,timeout:15000},
});
