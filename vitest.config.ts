import { defineConfig } from 'vitest/config';

// Fixture snapshots contain local timestamps from the original test timezone.
// Keep them deterministic across developer machines and CI runners.
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
	define: {
		DEBUG_MODE: false,
	},
	test: {
		include: ['src/**/*.test.ts'],
		globals: true,
		alias: {
			'webextension-polyfill': new URL('./src/utils/__mocks__/webextension-polyfill.ts', import.meta.url).pathname,
		},
	},
});
