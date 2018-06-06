/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import { matchesFuzzy } from 'vs/base/common/filters';
import { IContext, IHighlight, QuickOpenEntry, QuickOpenModel } from 'vs/base/parts/quickopen/browser/quickOpenModel';
import { IAutoFocus, Mode } from 'vs/base/parts/quickopen/common/quickOpen';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { BaseEditorQuickOpenAction } from 'vs/editor/standalone/browser/quickOpen/editorQuickOpen';
import { registerEditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

interface IFile {
	uri: string;
	basename: string;
	dirname: string;
}

class QuickOpenFileEntry extends QuickOpenEntry {

	constructor(highlights: IHighlight[], private file: IFile) {
		super();
		this.setHighlights(highlights);
		this.file = file;
	}

	public getLabel(): string {
		return this.file.basename;
	}

	public getAriaLabel(): string {
		return nls.localize('ariaLabelEntry', "{0}, files", this.getLabel());
	}

	public getDescription() {
		return this.file.dirname !== '.' ? this.file.dirname : '';
	}

	public run(mode: Mode, context: IContext): boolean {
		if (mode === Mode.OPEN) {
			document.dispatchEvent(new CustomEvent('show', {
				detail: {
					component: 'editor',
					arguments: {
						fileUri: this.file.uri,
						fileName: this.file.basename
					}
				}
			}));
			return true;
		}

		return false;
	}
}

class QuickOpenFileAction extends BaseEditorQuickOpenAction {

	constructor() {
		super(nls.localize('quickOpenFileActionInput', "Type the name of an file you want to open"), {
			id: 'editor.action.quickOpenFile',
			label: nls.localize('QuickOpenFileAction.label', "Quick Open File"),
			alias: 'Quick Open File',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_P
			},
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		fetch(consoleUri + '/quickOpen' + currentFolderUri).then(res => {
			if (res.status >= 200 && res.status <= 299) {
				return res.json().then((files: IFile[]) => {
					this._show(this.getController(editor), {
						getModel: (value: string): QuickOpenModel => {
							return new QuickOpenModel(this.filesToEntries(value, files));
						},

						getAutoFocus: (searchValue: string): IAutoFocus => {
							return {
								autoFocusFirstEntry: true,
								autoFocusPrefixMatch: searchValue
							};
						}
					});
				});
			} else {
				throw res;
			}
		}).catch(console.error);
	}

	private filesToEntries(searchValue: string, files: IFile[]): QuickOpenFileEntry[] {
		let entries: QuickOpenFileEntry[] = [];

		for (let i = 0; i < files.length; i++) {
			let file = files[i];
			let highlights = matchesFuzzy(searchValue, file.basename);
			if (highlights) {
				entries.push(new QuickOpenFileEntry(highlights, file));
			}
		}

		return entries;
	}
}

registerEditorAction(QuickOpenFileAction);

let currentFolderUri = '/files/~';
export function setCurrentFolder(folderUri: string) {
	currentFolderUri = folderUri;
}

let consoleUri: string;
export function setConsoleUri(uri: string) {
	consoleUri = uri;
}