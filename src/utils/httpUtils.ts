import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as vscode from 'vscode';

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