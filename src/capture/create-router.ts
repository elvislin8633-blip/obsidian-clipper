import { saveToObsidian } from '../utils/obsidian-note-creator';
import { ObsidianAdapter, type ObsidianSave } from './adapters/obsidian';
import { ResearchQueueAdapter } from './adapters/research-queue';
import { createCaptureRouter, type CaptureRouter } from './router';
import type { CaptureSettings } from './contracts';

export interface DefaultCaptureRouterOptions {
	obsidianSave?: ObsidianSave;
}

export function createDefaultCaptureRouter(
	settings: CaptureSettings,
	options: DefaultCaptureRouterOptions = {},
): CaptureRouter {
	return createCaptureRouter(settings, {
		obsidian: new ObsidianAdapter(options.obsidianSave || saveToObsidian),
		research_queue: new ResearchQueueAdapter(),
	});
}
