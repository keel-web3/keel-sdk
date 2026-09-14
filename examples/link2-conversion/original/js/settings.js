/**
 * Settings management utility for merging and sanitizing user settings
 * Provides type-safe settings merging with validation, sanitization, and clamping
 * Copyright (c) 2025 ertdfgcvb.xyz
 */

export const TYPES = {
	STRING: Symbol(),
	INT: Symbol(),
	FLOAT: Symbol(),
	BOOLEAN: Symbol(),
	COLOR_HEX: Symbol(),
	CHAR: Symbol(),
}

function clamp(val, min, max) {
	if (val < min) return min
	if (val > max) return max
	return val
}

function sanitize(value, expectedType) {
	// Skip if value is null or undefined
	if (value === null || value === undefined) return null

	let convertedValue = null

	if (expectedType === TYPES.STRING) {
		// String values are already strings
		convertedValue = String(value)
	}
	else if (expectedType === TYPES.INT) {
		// For INT, parse as float first to handle cases where a float is passed
		const parsed = parseFloat(value)
		if (!isNaN(parsed)) {
			// Floor the value to ensure it's an integer
			convertedValue = Math.floor(parsed)
		}
	}
	else if (expectedType === TYPES.FLOAT) {
		const parsed = parseFloat(value)
		if (!isNaN(parsed)) {
			convertedValue = parsed
		}
	}
	else if (expectedType === TYPES.BOOLEAN) {
		if (typeof value === 'boolean') {
			convertedValue = value
		} else {
			const s = String(value).trim().toLowerCase()
			if (s === '1' || s === 'true') convertedValue = true
			else if (s === '0' || s === 'false') convertedValue = false
		}
	}
	else if (expectedType === TYPES.CHAR) {
		// Accept a single character; support full Unicode (surrogate pairs)
		const arr = Array.from(String(value))
		if (arr.length > 0) {
			convertedValue = arr[0]
		}
	}
	else if (expectedType === TYPES.COLOR_HEX) {
		// For colors, expect hex values like "332200", "AAF", "#332200", or "#AAF"
		let hex = String(value).replace('#', '')

		// Handle 3-character hex (like "AAF")
		if (hex.length === 3) {
			hex = hex.split('').map(char => char + char).join('')
		}

		// Validate hex format (6 characters, valid hex digits)
		if (hex.length === 6 && /^[0-9A-Fa-f]{6}$/.test(hex)) {
			convertedValue = hex.toUpperCase()
		}
	}

	return convertedValue
}

export function mergeSettings(defaultSettings, userSettings) {
	const mergedSettings = {}

	// First, validate and set default settings
	Object.keys(defaultSettings).forEach(key => {
		const defaultSetting = defaultSettings[key]
		const validatedValue = sanitize(defaultSetting.value, defaultSetting.type)

		// Use validated value if conversion was successful, otherwise use original value
		mergedSettings[key] = validatedValue !== null ? validatedValue : defaultSetting.value
	})

	// Then, validate and apply user settings
	for (const [key, userValue] of userSettings) {
		const defaultSetting = defaultSettings[key]

		// Discard keys that aren't present in defaultSettings
		if (!defaultSetting) continue

		// Validate and convert user value
		const convertedValue = sanitize(userValue, defaultSetting.type)

		// Overwrite only if conversion was successful
		if (convertedValue !== null) {
			// Only clamp numeric types
			if (defaultSetting.type === TYPES.INT || defaultSetting.type === TYPES.FLOAT) {
				const min = (defaultSetting.min ?? -Infinity)
				const max = (defaultSetting.max ?? Infinity)
				mergedSettings[key] = clamp(convertedValue, min, max)
			} else {
				mergedSettings[key] = convertedValue
			}
		}
	}

	return mergedSettings
}