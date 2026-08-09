import browser from '../../utils/browser-polyfill';
import { sanitizeFileName } from '../../utils/string-utils';
import { generalSettings } from '../../utils/storage-utils';
import type { Template } from '../../types/types';
import type { ObsidianSave } from './obsidian';

/**
 * Delivery bridge for Quick Clip's MV3 service-worker entry point.
 *
 * The official Obsidian integration runs from extension pages and delegates
 * URI opening through the background message handler. A service worker cannot
 * use that same self-message/DOM clipboard path, so Quick Clip supplies this
 * delivery-only bridge while keeping the official popup/side-panel adapter
 * unchanged.
 */
export function createBackgroundObsidianSave(tabId: number): ObsidianSave {
	return async (fileContent, noteName, path, vault, behavior) => {
		let obsidianUrl: string;
		const isDailyNote = behavior === 'append-daily' || behavior === 'prepend-daily';

		if (isDailyNote) {
			obsidianUrl = 'obsidian://daily?';
		} else {
			if (path && !path.endsWith('/')) path += '/';
			obsidianUrl = `obsidian://new?file=${encodeURIComponent(path + sanitizeFileName(noteName))}`;
		}

		if (behavior.startsWith('append')) {
			obsidianUrl += '&append=true';
		} else if (behavior.startsWith('prepend')) {
			obsidianUrl += '&prepend=true';
		} else if (behavior === 'overwrite') {
			obsidianUrl += '&overwrite=true';
		}

		if (vault) obsidianUrl += `&vault=${encodeURIComponent(vault)}`;
		if (generalSettings.silentOpen) obsidianUrl += '&silent=true';

		let clipboardWritten = false;
		try {
			const response = await browser.tabs.sendMessage(tabId, {
				action: 'copy-text-to-clipboard',
				text: fileContent,
			}) as { success?: boolean } | undefined;
			clipboardWritten = response?.success === true;
		} catch {
			// Fall back to the official URI content parameter if the page cannot
			// receive the content-script clipboard request.
		}

		obsidianUrl += clipboardWritten
			? '&clipboard'
			: `&content=${encodeURIComponent(fileContent)}`;

		// This is the delivery boundary. If Chrome cannot hand the URI to the
		// operating system, reject so Router/Quick Clip cannot report success.
		await browser.tabs.update(tabId, { url: obsidianUrl });
	};
}
