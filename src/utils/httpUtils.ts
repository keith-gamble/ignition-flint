import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let axiosInstance: AxiosInstance | null = null;

export async function getAxiosInstance(forceRecreate: boolean = false): Promise<AxiosInstance> {
	if (forceRecreate) {
		axiosInstance = null;
	}

	if (!axiosInstance) {
		let sslVerify: boolean = await vscode.workspace.getConfiguration('ignitionFlint').get('sslVerify') as boolean;

		axiosInstance = axios.create({
			httpsAgent: new https.Agent({
				rejectUnauthorized: sslVerify,
			}),
			timeout: 5000,
		});
	}
	return axiosInstance;
}

export function readApiToken(tokenFilePath: string): string | null {
	try {
		const absolutePath = path.isAbsolute(tokenFilePath)
			? tokenFilePath
			: path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', tokenFilePath);

		const content = fs.readFileSync(absolutePath, 'utf8');
		const match = content.match(/ignition_token=(.+)/);
		return match ? match[1].trim() : null;
	}
	catch (error) {
		console.error(`Error reading API token from file: ${error}`);
		return null;
	}
}