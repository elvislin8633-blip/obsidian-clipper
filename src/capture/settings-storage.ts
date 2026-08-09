import browser from '../utils/browser-polyfill';
import {
	CAPTURE_SCHEMA_VERSION,
	DEFAULT_CAPTURE_SETTINGS,
	normalizeCaptureSettings,
	type CaptureSettings,
} from './contracts';

export const CAPTURE_SETTINGS_STORAGE_KEY = `capture_settings_v${CAPTURE_SCHEMA_VERSION}`;

interface StoredCaptureSettings {
	inboxPath?: unknown;
	projects?: unknown;
}

export async function loadCaptureSettings(): Promise<CaptureSettings> {
	const stored = await browser.storage.sync.get(CAPTURE_SETTINGS_STORAGE_KEY) as Record<string, unknown>;
	const raw = stored[CAPTURE_SETTINGS_STORAGE_KEY] as StoredCaptureSettings | undefined;
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAPTURE_SETTINGS, projects: [] };
	return normalizeCaptureSettings(raw as Partial<CaptureSettings>);
}

export async function saveCaptureSettings(settings: Partial<CaptureSettings>): Promise<CaptureSettings> {
	const current = await loadCaptureSettings();
	const normalized = normalizeCaptureSettings({ ...current, ...settings });
	await browser.storage.sync.set({ [CAPTURE_SETTINGS_STORAGE_KEY]: normalized });
	return normalized;
}
