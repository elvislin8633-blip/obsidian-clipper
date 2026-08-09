import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import browser from '../../utils/browser-polyfill';
import { createBackgroundObsidianSave } from './background-obsidian';

const originalSendMessage = browser.tabs.sendMessage;
const originalUpdate = browser.tabs.update;

beforeEach(() => {
	browser.tabs.sendMessage = vi.fn(async () => ({ success: true })) as unknown as typeof browser.tabs.sendMessage;
	browser.tabs.update = vi.fn(async (_tabId, updateProperties) => ({
		id: 42,
		...updateProperties,
	})) as unknown as typeof browser.tabs.update;
});

afterEach(() => {
	browser.tabs.sendMessage = originalSendMessage;
	browser.tabs.update = originalUpdate;
});

describe('createBackgroundObsidianSave', () => {
	test('uses the target tab clipboard and hands off the Obsidian URI', async () => {
		const save = createBackgroundObsidianSave(42);

		await save('## Example', 'Example', 'Inbox', 'Personal', 'create');

		expect(browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
			action: 'copy-text-to-clipboard',
			text: '## Example',
		});
		expect(browser.tabs.update).toHaveBeenCalledWith(42, {
			url: 'obsidian://new?file=Inbox%2FExample&vault=Personal&clipboard',
		});
	});

	test('falls back to URI content when the target page cannot copy', async () => {
		browser.tabs.sendMessage = vi.fn(async () => {
			throw new Error('no content script');
		}) as unknown as typeof browser.tabs.sendMessage;
		const save = createBackgroundObsidianSave(42);

		await save('## Example', 'Example', 'Inbox', '', 'create');

		expect(browser.tabs.update).toHaveBeenCalledWith(42, {
			url: 'obsidian://new?file=Inbox%2FExample&content=%23%23%20Example',
		});
	});

	test('propagates URI handoff failure', async () => {
		const failure = new Error('cannot open protocol handler');
		browser.tabs.update = vi.fn(async () => {
			throw failure;
		}) as unknown as typeof browser.tabs.update;
		const save = createBackgroundObsidianSave(42);

		await expect(save('## Example', 'Example', 'Inbox', '', 'create')).rejects.toBe(failure);
	});
});
