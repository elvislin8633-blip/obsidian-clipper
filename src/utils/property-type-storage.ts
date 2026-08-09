import type { PropertyType } from '../types/types';
import { generalSettings, saveSettings } from './storage-utils';

/**
 * Add or update a property type without depending on settings-page UI code.
 * This is also used by the background service worker while loading templates.
 */
export async function addPropertyType(
	name: string,
	type: string = 'text',
	defaultValue: string = ''
): Promise<void> {
	console.log(`addPropertyType called with: name=${name}, type=${type}, defaultValue=${defaultValue}`);
	const existingPropertyType = generalSettings.propertyTypes.find(pt => pt.name === name);
	if (!existingPropertyType) {
		console.log(`Adding new property type: ${name} with type ${type}`);
		const newPropertyType: PropertyType = { name, type };
		if (defaultValue !== null && defaultValue !== '') {
			newPropertyType.defaultValue = defaultValue;
		}
		generalSettings.propertyTypes.push(newPropertyType);
		await saveSettings();
	} else if (existingPropertyType.type !== type || existingPropertyType.defaultValue !== defaultValue) {
		console.log(`Updating existing property type: ${name} from ${existingPropertyType.type} to ${type}`);
		existingPropertyType.type = type;
		if (defaultValue !== null && defaultValue !== '') {
			existingPropertyType.defaultValue = defaultValue;
		} else {
			delete existingPropertyType.defaultValue;
		}
		await saveSettings();
	} else {
		console.log(`Property type ${name} already exists and is up to date`);
	}
	console.log('Current property types:', JSON.stringify(generalSettings.propertyTypes, null, 2));
}
