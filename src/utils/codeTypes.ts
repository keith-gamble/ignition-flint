import * as vscode from 'vscode';
import { FlintError } from './textEncoding';

export abstract class CodeType {
    abstract codeKey: string;
    abstract defaultFileName: string;
    abstract contextKey: string;
    abstract codeActionDetails: { text: string; command: string; title: string };

    abstract getFunctionDefinition(parentObject: object): string;
    abstract getFileName(parentObject: object): string;

    getJsonKey(): string {
        if (!this.codeKey) {
            return '';
        }

        const codeKeyParts = this.codeKey.split('.');
        return codeKeyParts[codeKeyParts.length - 1];
    }

    getCodeAction(document: vscode.TextDocument, lineNumber: number): vscode.CodeAction {
		const codeAction = new vscode.CodeAction(this.codeActionDetails.text, vscode.CodeActionKind.Empty);
		codeAction.command = {
			command: this.codeActionDetails.command,
			title: this.codeActionDetails.title,
			arguments: [document.uri, lineNumber],
		};
		return codeAction;
	}
}

export class scriptAction extends CodeType {
    codeKey = 'config.script';
    defaultFileName = 'runAction';
    contextKey = 'ignition-flint:lineIsScriptAction';
    codeActionDetails = { text: 'Edit Action', command: 'ignition-flint.edit-script-action', title: 'Edit Action' };

    getFunctionDefinition(parentObject: object): string {
        return 'def runAction(self, event):\n';
    }

    getFileName(parentObject: object): string {
        return this.defaultFileName;
    }
}

export class scriptTransform extends CodeType {
    codeKey = 'transforms.code';
    defaultFileName = 'transform';
    contextKey = 'ignition-flint:lineIsScriptTransform';
    codeActionDetails = { text: 'Edit Transform', command: 'ignition-flint.edit-script-transform', title: 'Edit Transform' };

    getFunctionDefinition(parentObject: object): string {
        return 'def transform(self, value, quality, timestamp):\n';
    }

    getFileName(parentObject: object): string {
        return this.defaultFileName;
    }
}

export class customMethod extends CodeType {
    codeKey = 'customMethods.script';
    defaultFileName = 'customMethod';
    contextKey = 'ignition-flint:lineIsCustomMethod';
    codeActionDetails = { text: 'Edit Method', command: 'ignition-flint.edit-custom-method', title: 'Edit Method' };

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

    getFileName(parentObject: object): string {
        if ('name' in parentObject) {
            return parentObject['name'] as string;
        }
        return this.defaultFileName;
    }
}

export class messageHandler extends CodeType {
    codeKey = 'messageHandlers.script';
    defaultFileName = 'onMessageReceived';
    contextKey = 'ignition-flint:lineIsMessageHandler';
    codeActionDetails = { text: 'Edit Message Handler', command: 'ignition-flint.edit-message-handler', title: 'Edit Handler' };

    getFunctionDefinition(parentObject: object): string {
        return 'def onMessageReceived(self, payload):\n';
    }

    getFileName(parentObject: object): string {
        if ('messageType' in parentObject) {
            return parentObject['messageType'] as string;
        }
        return this.defaultFileName;
    }
}

export class tagEventScript extends CodeType {
    codeKey = 'eventScripts.script';
    defaultFileName = 'tagEventScript';
    contextKey = 'ignition-flint:lineIsTagEventScript';
    codeActionDetails = { text: 'Edit Tag Event Script', command: 'ignition-flint.edit-tag-event-script', title: 'Edit Tag Event Script' };

    getFunctionDefinition(parentObject: object): string {
        return 'def valueChanged(tag, tagPath, previousValue, currentValue, initialChange, missedEvents):\n';
    }

    getFileName(parentObject: object): string {
        if ('eventid' in parentObject) {
            return parentObject['eventid'] as string;
        }
        return this.defaultFileName;
    }
}

export class propertyChangeScript extends CodeType {
	codeKey = "onChange.script";
	defaultFileName = "onChange";
	contextKey = "ignition-flint:lineIsPropertyChangeScript";
	codeActionDetails = { text: "Edit Property Change Script", command: "ignition-flint.edit-property-change-script", title: "Edit Property Change Script" };

	getFunctionDefinition(parentObject: object): string {
		return "def valueChanged(self, previousValue, currentValue, origin, missedEvents):\n";
	}

	getFileName(parentObject: object): string {
		if ("property" in parentObject) {
			return parentObject["property"] as string;
		}
		return this.defaultFileName;
	}
}


export const codeTypeMap = new Map<string, CodeType>([
    ['transforms.code', new scriptTransform()],
    ['config.script', new scriptAction()],
    ['customMethods.script', new customMethod()],
    ['messageHandlers.script', new messageHandler()],
    ['eventScripts.script', new tagEventScript()],
	['onChange.script', new propertyChangeScript()],
]);

export function getCodeType(codeKey: string): CodeType | undefined {
    return codeTypeMap.get(codeKey);
}

export function getCodeTypeFromPath(linePath: string): CodeType | undefined {
    // Remove any array index numbers
    const cleanedPath = linePath.replace(/\.\d+\./g, '.');
    const keyParts = cleanedPath.split('.');

    const codeTypeKey = `${keyParts[keyParts.length - 2]}.${keyParts[keyParts.length - 1]}`;
    return getCodeType(codeTypeKey);
}

export function insertFunctionDefinition(codeText: string, codeType: CodeType, parentObject: object): string {
    const functionDefinition = codeType.getFunctionDefinition(parentObject);
    return functionDefinition + codeText;
}

export function removeFunctionDefinition(codeText: string, codeType: CodeType, parentObject: object): string {
    const functionDefinition = codeType.getFunctionDefinition(parentObject);

    if (!codeText.includes(functionDefinition)) {
        vscode.window.showErrorMessage(
            'Cannot update code with edited function definition, please reset the function definition and try again.',
            { title: 'Copy definition' },
        ).then((selected) => {
            if (selected && selected.title === 'Copy definition') {
                vscode.env.clipboard.writeText(functionDefinition.slice(0, -1));
            }
        });

        throw new FlintError('Code text does not contain the function definition');
    }

    return codeText.replace(functionDefinition, '');
}