import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The SQLite-heavy suite opens many migrated in-memory databases. Keep the
    // worker pool below macOS's default file-descriptor ceiling.
    maxWorkers: 4,
    env: {
      SESSION_SECRET: 'vitest-secret-not-for-production',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
