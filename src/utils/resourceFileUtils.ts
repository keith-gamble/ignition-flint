import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function buildResourceFileContents(context: vscode.ExtensionContext): Promise<string> {
  const resourceFilePath = path.join(context.extensionPath, 'src', 'templates', 'resource.json');
  let resourceFileContents = await fs.promises.readFile(resourceFilePath, 'utf-8');

  // replace $$TIMESTAMP$$ with the current timestamp in the YYYY-MM-ddTHH:mm:ssZ format
  const timestamp = new Date().toISOString();
  const timestampRegex = /\$\$timestamp\$\$/g;
  resourceFileContents = resourceFileContents.replace(timestampRegex, timestamp);

  // Replace $$username$$ with the current user's username
  const username = process.env.USERNAME || 'flint-extension';
  const usernameRegex = /\$\$actor\$\$/g;
  resourceFileContents = resourceFileContents.replace(usernameRegex, username);

  return resourceFileContents;
}