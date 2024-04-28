

// Create a structure that can be used to compare version numbers in X.Y.Z format
export class Version {
	major: number;
	minor: number;
	patch: number;

	constructor(version: string) {
		const versionParts = version.split('.');
		this.major = parseInt(versionParts[0]);
		this.minor = parseInt(versionParts[1]);
		this.patch = parseInt(versionParts[2]);
	}
}

export function isVersionAtMinimum(version: string, requiredVersion: string): boolean {
	const versionObj = new Version(version);
	const requiredVersionObj = new Version(requiredVersion);

	if (versionObj.major < requiredVersionObj.major) {
		return false;
	} else if (versionObj.major > requiredVersionObj.major) {
		return true;
	}

	if (versionObj.minor < requiredVersionObj.minor) {
		return false;
	} else if (versionObj.minor > requiredVersionObj.minor) {
		return true;
	}

	if (versionObj.patch < requiredVersionObj.patch) {
		return false;
	}

	return true;
}

export function isVersionAtMaximum(version: string, requiredVersion: string): boolean {
	const versionObj = new Version(version);
	const requiredVersionObj = new Version(requiredVersion);

	if (versionObj.major > requiredVersionObj.major) {
		return false;
	} else if (versionObj.major < requiredVersionObj.major) {
		return true;
	}

	if (versionObj.minor > requiredVersionObj.minor) {
		return false;
	} else if (versionObj.minor < requiredVersionObj.minor) {
		return true;
	}

	if (versionObj.patch > requiredVersionObj.patch) {
		return false;
	}

	return true;
}

export function isVersionInRange(version: string, minVersion: string, maxVersion: string): boolean {
	return isVersionAtMinimum(version, minVersion) && !isVersionAtMinimum(version, maxVersion);
}
