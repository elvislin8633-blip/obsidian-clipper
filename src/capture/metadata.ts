import type { Property } from '../types/types';
import type {
	CaptureContext,
	CapturePayload,
	DestinationId,
	ReservedCaptureMetadata,
} from './contracts';

export const RESERVED_CAPTURE_KEYS = [
	'capture_id',
	'capture_intent',
	'capture_project_id',
	'capture_project_name',
	'capture_destination',
	'capture_captured_at',
] as const;

export function createReservedCaptureMetadata(
	context: CaptureContext,
	destination: DestinationId,
): ReservedCaptureMetadata {
	const metadata: ReservedCaptureMetadata = {
		capture_id: context.captureId,
		capture_intent: context.intent,
		capture_destination: destination,
		capture_captured_at: context.capturedAt,
	};

	if (context.projectId) {
		metadata.capture_project_id = context.projectId;
	}
	if (context.projectName) {
		metadata.capture_project_name = context.projectName;
	}

	return metadata;
}

export function reservedMetadataToProperties(metadata: ReservedCaptureMetadata): Property[] {
	return Object.entries(metadata).map(([name, value]) => ({
		name,
		value: String(value),
	}));
}

function propertyKeyFromFrontmatterLine(line: string): string | null {
	const match = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:/);
	return match?.[1] || match?.[2] || match?.[3] || null;
}

function removeReservedPropertiesFromFrontmatter(fileContent: string): string {
	const lines = fileContent.split('\n');
	if (lines[0] !== '---') return fileContent;

	const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
	if (closingIndex < 0) return fileContent;

	const output: string[] = [lines[0]];
	let skipContinuation = false;
	for (let index = 1; index < closingIndex; index++) {
		const line = lines[index];
		const key = propertyKeyFromFrontmatterLine(line);
		if (key && (RESERVED_CAPTURE_KEYS as readonly string[]).includes(key)) {
			skipContinuation = true;
			continue;
		}
		if (skipContinuation && /^\s+/.test(line) && !key) {
			continue;
		}
		skipContinuation = false;
		output.push(line);
	}
	output.push(...lines.slice(closingIndex));
	return output.join('\n');
}

function insertReservedProperties(
	fileContent: string,
	reservedFrontmatter: string,
): string {
	const cleanContent = removeReservedPropertiesFromFrontmatter(fileContent);
	const reservedLines = reservedFrontmatter
		.replace(/^---\n?/, '')
		.replace(/\n---\n?$/, '')
		.trimEnd();
	if (!reservedLines) return cleanContent;

	if (!cleanContent.startsWith('---\n')) {
		return `${reservedFrontmatter}${cleanContent}`;
	}

	const closingIndex = cleanContent.indexOf('\n---', 4);
	if (closingIndex < 0) {
		return `${reservedFrontmatter}${cleanContent}`;
	}

	return `${cleanContent.slice(0, closingIndex)}\n${reservedLines}${cleanContent.slice(closingIndex)}`;
}

export async function addReservedMetadataToPayload(
	payload: CapturePayload,
	metadata: ReservedCaptureMetadata,
	generateFrontmatter: (properties: Property[]) => Promise<string>,
): Promise<CapturePayload> {
	const reservedFrontmatter = await generateFrontmatter(reservedMetadataToProperties(metadata));
	return {
		...payload,
		fileContent: insertReservedProperties(payload.fileContent, reservedFrontmatter),
	};
}
