import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative assets work for both repository Pages and a custom domain.
  base: './',
  build: {
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/node_modules/@xyflow/')) return 'topology';
      if (id.includes('/node_modules/dexie/')) return 'persistence';
      // The UI-independent engines (network, CLI, AWS, Terraform, labs) change together and are needed at startup.
      if (/\/src\/(simulator|cli|aws|terraform|labs)\//.test(id)) return 'engine';
    } } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
