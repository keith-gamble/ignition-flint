import * as vscode from 'vscode';

// Create the CODE type interface
export abstract class CodeType {
	abstract codeKey: string;
	abstract fileName: string;
	abstract contextKey: string;
	abstract codeActionDetails: { text: string; command: string; title: string; };

	abstract getFunctionDefinition(): string;

	getJsonKey(): string {
		// Get the last part of the code key
		if (!this.codeKey) {
			return '';
		}

		let codeKeyParts = this.codeKey.split('.');
		let jsonKey = codeKeyParts[codeKeyParts.length - 1];

		return jsonKey;
	}

	getCodeAction(document: vscode.TextDocument): vscode.CodeAction {
		// Create the code action
		let codeAction = new vscode.CodeAction(this.codeActionDetails.text, vscode.CodeActionKind.Empty);
		codeAction.command = { command: this.codeActionDetails.command, title: this.codeActionDetails.title, arguments: [document] };

		return codeAction;
	}
}

export class scriptAction extends CodeType {
	codeKey = 'config.script';
	fileName = 'runAction';
	contextKey = 'ignition-flint:lineIsScriptAction';
	codeActionDetails = { text: 'Edit Action', command: 'ignition-flint.edit-script-action', title: 'Edit Action' };

	getFunctionDefinition(): string {
		return 'def runAction(self, event):\n';
	}
}

export class scriptTransform extends CodeType {
	codeKey = 'transforms.code';
	fileName = 'transform';
	contextKey = 'ignition-flint:lineIsScriptTransform';

	codeActionDetails = { text: 'Edit Transform', command: 'ignition-flint.edit-script-transform', title: 'Edit Transform' };

	getFunctionDefinition(): string {
		return 'def transform(self, value, quality, timestamp):\n';
	}
}

export class customMethod extends CodeType {
	codeKey = 'customMethods.script';
	fileName = 'customMethod';
	contextKey = 'ignition-flint:lineIsCustomMethod';
	codeActionDetails = { text: 'Edit Method', command: 'ignition-flint.edit-custom-method', title: 'Edit Method' };

	getFunctionDefinition(): string {
		return 'def customMethod(self, **kwargs):\n';
	}
}

export class messageHandler extends CodeType {
	codeKey = 'messageHandlers.script';
	fileName = 'onMessageReceived';
	contextKey = 'ignition-flint:lineIsMessageHandler';
	codeActionDetails = { text: 'Edit Message Handler', command: 'ignition-flint.edit-message-handler', title: 'Edit Handler' };

	getFunctionDefinition(): string {
		return 'def onMessageReceived(self, payload):\n';
	}
}

export class tagEventScript extends CodeType {
	codeKey = 'eventScripts.script';
	fileName = 'GET_EVENT_SCRIPT_NAME_LATER';
	contextKey = 'ignition-flint:lineIsTagEventScript';
	codeActionDetails = { text: 'Edit Tag Event Script', command: 'ignition-flint.edit-tag-event-script', title: 'Edit Tag Event Script' };

	getFunctionDefinition(): string {
		return 'def valueChanged(tag, tagPath, previousValue, currentValue, initialChange, missedEvents):\n';
	}
}

export const codeTypeMap = new Map<string, CodeType>([    
	["transforms.code", new scriptTransform()],
	["config.script", new scriptAction()],
	["customMethods.script", new customMethod()],
	["messageHandlers.script", new messageHandler()],
	["eventScripts.script", new tagEventScript()]
]);


export function getCodeType(codeKey: string): CodeType | undefined {
	return codeTypeMap.get(codeKey);
}


export function getCodeTypeFromPath(linePath: string): CodeType | undefined {
	// Example: children.0.events.component.onActionPerformed.config.script 
	// Get the last 2 parts of the key and use it to pull the code type
	
	// Remove any array index numbers
	linePath = linePath.replace(/\.\d+\./g, '.');
	const keyParts = linePath.split('.');

	const codeTypeKey = keyParts[keyParts.length - 2] + '.' + keyParts[keyParts.length - 1];

	return getCodeType(codeTypeKey);
}


export function insertFunctionDefinition(codeText: string, codeType: CodeType): string {
	const functionDefinition = codeType.getFunctionDefinition();
	return functionDefinition + codeText;
}	

export function removeFunctionDefinition(codeText: string, codeType: CodeType): string {
	// Get the code type
	const functionDefinition = codeType.getFunctionDefinition();
	return codeText.replace(functionDefinition, '');
}

export function registerCommands(context: vscode.ExtensionContext, callable: (document: vscode.TextDocument, codeType: CodeType) => void | Promise<void>) {
	// Iterate through the codeTypeMap
	codeTypeMap.forEach((codeType) => {
		context.subscriptions.push(vscode.commands.registerCommand(codeType.codeActionDetails.command, (document: vscode.TextDocument) => { callable(document, codeType)} )); 
	}
	);
}


