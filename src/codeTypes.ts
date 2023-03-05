import * as vscode from 'vscode';
import { FlintError } from './flintUtils';

/**
 * Abstract class for Code Types.
 */
export abstract class CodeType {
	abstract codeKey: string; // The unique key for this type of code.
	abstract defaultFileName: string; // The default file name for this type of code.
	abstract contextKey: string; // The context key for this type of code.
	abstract codeActionDetails: { text: string; command: string; title: string; }; // The details for the code action.

	/**
	 * Abstract method to get the function definition for this type of code.
	 *
	 * @param parentObject - The parent object.
	 */
	abstract getFunctionDefinition(parentObject: object): string;

	/**
	 * Abstract method to get the file name for this type of code.
	 *
	 * @param parentObject - The parent object.
	 */
	abstract getFileName(parentObject: object): string;

	/**
	 * Method to get the last part of the code key.
	 *
	 * @returns The last part of the code key.
	 */
	getJsonKey(): string {
		if (!this.codeKey) {
			return '';
		}

		let codeKeyParts = this.codeKey.split('.');
		let jsonKey = codeKeyParts[codeKeyParts.length - 1];

		return jsonKey;
	}

	/**
	 * Method to create a code action for this type of code.
	 *
	 * @param document - The text document.
	 * @returns A code action.
	 */
	getCodeAction(document: vscode.TextDocument): vscode.CodeAction {
		let codeAction = new vscode.CodeAction(this.codeActionDetails.text, vscode.CodeActionKind.Empty);
		codeAction.command = { command: this.codeActionDetails.command, title: this.codeActionDetails.title, arguments: [document] };

		return codeAction;
	}
}

/**
 * Class for script actions.
 */
export class scriptAction extends CodeType {
	codeKey = 'config.script';
	defaultFileName = 'runAction';
	contextKey = 'ignition-flint:lineIsScriptAction';
	codeActionDetails = { text: 'Edit Action', command: 'ignition-flint.edit-script-action', title: 'Edit Action' };

	/**
	 * Method to get the function definition for a script action.
	 *
	 * @param parentObject - The parent object.
	 * @returns The function definition.
	 */
	getFunctionDefinition(parentObject: object): string {
		return 'def runAction(self, event):\n';
	}

	/**
	 * Method to get the file name for a script action.
	 *
	 * @param parentObject - The parent object.
	 * @returns The file name.
	 */
	getFileName(parentObject: object): string {
		return this.defaultFileName;
	}
}
/**
 * Class for script transforms.
 */
export class scriptTransform extends CodeType {
	codeKey = 'transforms.code'; // The unique key for script transforms.
	defaultFileName = 'transform'; // The default file name for script transforms.
	contextKey = 'ignition-flint:lineIsScriptTransform'; // The context key for script transforms.
	codeActionDetails = { text: 'Edit Transform', command: 'ignition-flint.edit-script-transform', title: 'Edit Transform' }; // The details for the code action.

	/**
	 * Method to get the function definition for a script transform.
	 *
	 * @param parentObject - The parent object.
	 * @returns The function definition.
	 */
	getFunctionDefinition(parentObject: object): string {
		return 'def transform(self, value, quality, timestamp):\n';
	}

	/**
	 * Method to get the file name for a script transform.
	 *
	 * @param parentObject - The parent object.
	 * @returns The file name.
	 */
	getFileName(parentObject: object): string {
		return this.defaultFileName;
	}
}

/**
 * Class for custom methods.
 */
export class customMethod extends CodeType {
	codeKey = 'customMethods.script'; // The unique key for custom methods.
	defaultFileName = 'customMethod'; // The default file name for custom methods.
	contextKey = 'ignition-flint:lineIsCustomMethod'; // The context key for custom methods.
	codeActionDetails = { text: 'Edit Method', command: 'ignition-flint.edit-custom-method', title: 'Edit Method' }; // The details for the code action.

	/**
	 * Method to get the function definition for a custom method.
	 *
	 * @param parentObject - The parent object.
	 * @returns The function definition.
	 */
	getFunctionDefinition(parentObject: object): string {
		let functionName = 'customMethod';
		if ('name' in parentObject) {
			functionName = parentObject['name'] as string;
		}

		let paramString = 'self';
		if ('params' in parentObject) {
			let params = parentObject['params'] as string[];

			if (params.length > 0) {
				paramString = 'self, ' + params.join(', ');
			}
		}

		return 'def ' + functionName + '(' + paramString + '):\n';
	}

	/**
	 * Method to get the file name for a custom method.
	 *
	 * @param parentObject - The parent object.
	 * @returns The file name.
	 */
	getFileName(parentObject: object): string {
		if ('name' in parentObject) {
			return parentObject['name'] as string;
		}
		return this.defaultFileName;
	}
}
/**
 * Class for message handlers.
 */
export class messageHandler extends CodeType {
	codeKey = 'messageHandlers.script'; // The unique key for message handlers.
	defaultFileName = 'onMessageReceived'; // The default file name for message handlers.
	contextKey = 'ignition-flint:lineIsMessageHandler'; // The context key for message handlers.
	codeActionDetails = { text: 'Edit Message Handler', command: 'ignition-flint.edit-message-handler', title: 'Edit Handler' }; // The details for the code action.

	/**
	 * Method to get the function definition for a message handler.
	 *
	 * @param parentObject - The parent object.
	 * @returns The function definition.
	 */
	getFunctionDefinition(parentObject: object): string {
		return 'def onMessageReceived(self, payload):\n';
	}

	/**
	 * Method to get the file name for a message handler.
	 *
	 * @param parentObject - The parent object.
	 * @returns The file name.
	 */
	getFileName(parentObject: object): string {
		if ('messageType' in parentObject) {
			return parentObject['messageType'] as string;
		}
		return this.defaultFileName;
	}
}

/**
 * Class for tag event scripts.
 */
export class tagEventScript extends CodeType {
	codeKey = 'eventScripts.script'; // The unique key for tag event scripts.
	defaultFileName = 'tagEventScript'; // The default file name for tag event scripts.
	contextKey = 'ignition-flint:lineIsTagEventScript'; // The context key for tag event scripts.
	codeActionDetails = { text: 'Edit Tag Event Script', command: 'ignition-flint.edit-tag-event-script', title: 'Edit Tag Event Script' }; // The details for the code action.

	/**
	 * Method to get the function definition for a tag event script.
	 *
	 * @param parentObject - The parent object.
	 * @returns The function definition.
	 */
	getFunctionDefinition(parentObject: object): string {
		return 'def valueChanged(tag, tagPath, previousValue, currentValue, initialChange, missedEvents):\n';
	}

	/**
	 * Method to get the file name for a tag event script.
	 *
	 * @param parentObject - The parent object.
	 * @returns The file name.
	 */
	getFileName(parentObject: object): string {
		if ('eventid' in parentObject) {
			return parentObject['eventid'] as string;
		}
		return this.defaultFileName;
	}
}

/**
 * Map that associates a unique code key with a code type.
 */
export const codeTypeMap = new Map<string, CodeType>([
	["transforms.code", new scriptTransform()], // Adds a script transform code type to the map.
	["config.script", new scriptAction()], // Adds a script action code type to the map.
	["customMethods.script", new customMethod()], // Adds a custom method code type to the map.
	["messageHandlers.script", new messageHandler()], // Adds a message handler code type to the map.
	["eventScripts.script", new tagEventScript()] // Adds a tag event script code type to the map.
]);

/**
 * Method to get the code type associated with a code key.
 *
 * @param codeKey - The code key.
 * @returns The code type associated with the code key.
 */
export function getCodeType(codeKey: string): CodeType | undefined {
	return codeTypeMap.get(codeKey);
}

/**
 * Method to get the code type from a line path.
 *
 * @param linePath - The line path.
 * @returns The code type associated with the line path.
 */
export function getCodeTypeFromPath(linePath: string): CodeType | undefined {
	// Example: children.0.events.component.onActionPerformed.config.script
	// Get the last 2 parts of the key and use it to pull the code type

	// Remove any array index numbers
	linePath = linePath.replace(/\.\d+\./g, '.');
	const keyParts = linePath.split('.');

	const codeTypeKey = keyParts[keyParts.length - 2] + '.' + keyParts[keyParts.length - 1];

	return getCodeType(codeTypeKey);
}

/**
 * Method to insert a function definition into code text.
 *
 * @param codeText - The code text.
 * @param codeType - The code type.
 * @param parentObject - The parent object.
 * @returns The modified code text.
 */
export function insertFunctionDefinition(codeText: string, codeType: CodeType, parentObject: object): string {
	const functionDefinition = codeType.getFunctionDefinition(parentObject);
	return functionDefinition + codeText;
}

/**
 * Method to remove a function definition from code text.
 *
 * @param codeText - The code text.
 * @param codeType - The code type.
 * @param parentObject - The parent object.
 * @returns The modified code text.
 * @throws FlintError if the code text does not contain the function definition.
 */
export function removeFunctionDefinition(codeText: string, codeType: CodeType, parentObject: object): string {
	// Get the function definition
	const functionDefinition = codeType.getFunctionDefinition(parentObject);

	if (!codeText.includes(functionDefinition)) {
		vscode.window.showErrorMessage(
			'Cannot update code with edited function definition, please reset the function definition and try again.',
			{ title: 'Copy definition' },
		).then((selected) => {
			if (selected && selected.title === 'Copy definition') {
				// Copy the function definition to the clipboard, but remove the last character (the newline)
				vscode.env.clipboard.writeText(functionDefinition.slice(0, -1));
			}
		});

		throw new FlintError('Code text does not contain the function definition');
	}

	return codeText.replace(functionDefinition, '');
}

/**
 * Method to register code action commands for each code type.
 *
 * @param context - The extension context.
 * @param callable - The callable function.
 */
export function registerCommands(context: vscode.ExtensionContext, callable: (document: vscode.TextDocument, codeType: CodeType) => void | Promise<void>) {
	// Iterate through the codeTypeMap
	codeTypeMap.forEach((codeType) => {
		context.subscriptions.push(vscode.commands.registerCommand(codeType.codeActionDetails.command, (document: vscode.TextDocument) => { callable(document, codeType)} )); 
	}
	);
}


