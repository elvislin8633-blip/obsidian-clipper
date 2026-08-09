import { saveFile } from '../utils/file-utils';
import { getMessage } from '../utils/i18n';
import {
	createProjectId,
	type CaptureProject,
	type CaptureSettings,
} from '../capture/contracts';
import { loadCaptureSettings, saveCaptureSettings } from '../capture/settings-storage';
import { clearResearchQueue, readResearchQueue } from '../capture/queue-storage';

let captureSettings: CaptureSettings = { inboxPath: 'Inbox', projects: [] };

function renderProjects(): void {
	const list = document.getElementById('capture-project-list');
	if (!list) return;
	list.textContent = '';

	captureSettings.projects.forEach(project => {
		const item = document.createElement('li');
		item.className = 'capture-project-item';
		item.dataset.projectId = project.id;

		const input = document.createElement('input');
		input.type = 'text';
		input.value = project.name;
		input.setAttribute('aria-label', getMessage('captureProjectName'));
		input.addEventListener('change', async () => {
			const name = input.value.trim();
			if (!name) {
				input.value = project.name;
				return;
			}
			const updatedProjects = captureSettings.projects.map(candidate =>
				candidate.id === project.id ? { ...candidate, name } : candidate
			);
			captureSettings = await saveCaptureSettings({ projects: updatedProjects });
		});

		const removeButton = document.createElement('button');
		removeButton.type = 'button';
		removeButton.className = 'setting-item-list-remove';
		removeButton.textContent = getMessage('remove');
		removeButton.addEventListener('click', async () => {
			captureSettings = await saveCaptureSettings({
				projects: captureSettings.projects.filter(candidate => candidate.id !== project.id),
			});
			renderProjects();
		});

		item.append(input, removeButton);
		list.appendChild(item);
	});
}

async function addProject(input: HTMLInputElement): Promise<void> {
	const name = input.value.trim();
	if (!name) return;
	if (captureSettings.projects.some(project => project.name.toLowerCase() === name.toLowerCase())) {
		input.value = '';
		return;
	}

	const project: CaptureProject = { id: createProjectId(), name };
	captureSettings = await saveCaptureSettings({
		projects: [...captureSettings.projects, project],
	});
	input.value = '';
	renderProjects();
}

async function updateQueueCount(): Promise<void> {
	const countElement = document.getElementById('research-queue-count');
	if (!countElement) return;
	try {
		const queue = await readResearchQueue();
		countElement.textContent = getMessage('researchQueuePending', [String(queue.length)]);
	} catch (error) {
		console.error('Unable to read Research Queue:', error);
		countElement.textContent = getMessage('researchQueueUnavailable');
	}
}

async function exportResearchQueue(): Promise<void> {
	const queue = await readResearchQueue();
	await saveFile({
		content: JSON.stringify(queue, null, 2),
		fileName: 'research-queue.json',
		mimeType: 'application/json',
	});
}

async function clearQueue(): Promise<void> {
	if (!window.confirm(getMessage('confirmClearResearchQueue'))) return;
	await clearResearchQueue();
	await updateQueueCount();
}

export async function initializeCaptureSettingsUI(): Promise<void> {
	captureSettings = await loadCaptureSettings();

	const inboxPath = document.getElementById('capture-inbox-path') as HTMLInputElement | null;
	if (inboxPath) {
		inboxPath.value = captureSettings.inboxPath;
		inboxPath.addEventListener('change', async () => {
			captureSettings = await saveCaptureSettings({ inboxPath: inboxPath.value });
			inboxPath.value = captureSettings.inboxPath;
		});
	}

	const projectInput = document.getElementById('capture-project-input') as HTMLInputElement | null;
	if (projectInput) {
		projectInput.addEventListener('keypress', async event => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			await addProject(projectInput);
		});
	}

	renderProjects();
	await updateQueueCount();

	document.getElementById('export-research-queue-btn')?.addEventListener('click', async () => {
		try {
			await exportResearchQueue();
		} catch (error) {
			console.error('Unable to export Research Queue:', error);
			alert(getMessage('researchQueueExportFailed'));
		}
	});
	document.getElementById('clear-research-queue-btn')?.addEventListener('click', async () => {
		try {
			await clearQueue();
		} catch (error) {
			console.error('Unable to clear Research Queue:', error);
			alert(getMessage('researchQueueClearFailed'));
		}
	});
}
