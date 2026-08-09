import type { Template } from '../types/types';

export const CAPTURE_SCHEMA_VERSION = 1 as const;

export type CaptureIntent =
	| 'reference'
	| 'read_later'
	| 'research'
	| 'knowledge'
	| 'project_material';

export type DestinationId = 'obsidian' | 'research_queue';

export interface CaptureProject {
	id: string;
	name: string;
}

export interface CaptureSettings {
	inboxPath: string;
	projects: CaptureProject[];
}

export interface CaptureSource {
	url: string;
	title: string;
	selection?: string;
	author?: string;
	site?: string;
	published?: string;
}

export interface CapturePayload {
	fileContent: string;
	noteName: string;
	path: string;
	behavior: Template['behavior'];
	vault: string;
	templateId: string;
}

export interface CaptureContext {
	captureId: string;
	capturedAt: string;
	intent: CaptureIntent;
	projectId?: string;
	projectName?: string;
	source: CaptureSource;
}

export interface ReservedCaptureMetadata {
	capture_id: string;
	capture_intent: CaptureIntent;
	capture_project_id?: string;
	capture_project_name?: string;
	capture_destination: DestinationId;
	capture_captured_at: string;
}

export interface CaptureEnvelope {
	schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
	payload: CapturePayload;
	context: CaptureContext;
	destination: DestinationId;
	metadata: ReservedCaptureMetadata;
}

export interface RoutingResult {
	schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
	captureId: string;
	destination: DestinationId;
	status: 'delivered';
	adapterId: DestinationId;
	noteName?: string;
	path?: string;
	queueRecordId?: string;
}

export interface DestinationAdapter {
	readonly id: DestinationId;
	deliver(envelope: CaptureEnvelope): Promise<RoutingResult>;
}

export interface ResearchQueueRecord {
	schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
	recordId: string;
	status: 'queued';
	queuedAt: string;
	destination: 'research_queue';
	context: CaptureContext;
	metadata: ReservedCaptureMetadata;
	payload: {
		fileContent: string;
		noteName: string;
		templateId: string;
	};
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
	inboxPath: 'Inbox',
	projects: [],
};

export function createCaptureId(): string {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeCaptureSettings(settings?: Partial<CaptureSettings>): CaptureSettings {
	const projects = Array.isArray(settings?.projects)
		? settings.projects
			.filter(project => project && typeof project.id === 'string' && typeof project.name === 'string')
			.map(project => ({ id: project.id.trim(), name: project.name.trim() }))
			.filter(project => project.id.length > 0 && project.name.length > 0)
		: DEFAULT_CAPTURE_SETTINGS.projects;

	const uniqueProjects = projects.filter((project, index, all) =>
		all.findIndex(candidate => candidate.id === project.id) === index
	);

	return {
		inboxPath: typeof settings?.inboxPath === 'string' && settings.inboxPath.trim()
			? settings.inboxPath.trim().replace(/^\/+|\/+$/g, '')
			: DEFAULT_CAPTURE_SETTINGS.inboxPath,
		projects: uniqueProjects,
	};
}

export function createProjectId(): string {
	return `project-${createCaptureId().replace(/^capture-/, '')}`;
}
