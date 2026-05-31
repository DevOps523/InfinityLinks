import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '.codex-security-scans/**', '.worktrees/**'],
    globals: true,
    passWithNoTests: true,
    setupFiles: []
  }
});
