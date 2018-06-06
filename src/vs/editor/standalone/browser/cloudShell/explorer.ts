/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Tree } from 'vs/base/parts/tree/browser/treeImpl';
import { IDataSource, IRenderer, IController, ISorter } from 'vs/base/parts/tree/browser/tree';
import { TPromise } from 'vs/base/common/winjs.base';
import { Color } from 'vs/base/common/color';

interface IEntry {
	uri: string;
	name: string;
	isFolder: boolean;
	isEditable?: boolean;
	parent?: IEntry;
}

class DataSource implements IDataSource {

	newEntryParentUri: string;
	newEntryIsFolder = false;

	getId(tree, element) {
		return element.uri;
	}
	hasChildren(tree, element) {
		return element.isFolder;
	}
	getChildren(tree, element) {
		return TPromise.wrap(
			fetch(consoleUri + element.uri)
				.then(res => {
					if (res.status >= 200 && res.status <= 299) {
						return res.json()
							.then((entries: IEntry[]) => {
								if (this.newEntryParentUri && element.uri === this.newEntryParentUri) {
									entries.push({
										uri: element.uri + '?newentry',
										name: '',
										isFolder: this.newEntryIsFolder,
										isEditable: true
									});
								}
								entries.forEach(entry => entry.parent = element);
								return entries;
							});
					} else {
						throw res;
					}
				})
		);
	}
	getParent(tree, element) {
		return element.parent;
	}
}

class Renderer implements IRenderer {

	private static TEMPLATE_ID = 'explorer_entry';
	private static EDITABLE_TEMPLATE_ID = 'editable_explorer_entry';

	constructor(private dataSource: DataSource) { }

	getHeight(tree, element) {
		return 22;
	}
	getTemplateId(tree, element) {
		return element.isEditable ? Renderer.EDITABLE_TEMPLATE_ID : Renderer.TEMPLATE_ID;
	}

	renderTemplate(tree, templateId, container) {
		if (templateId === Renderer.TEMPLATE_ID) {
			const span = document.createElement('span');
			span.classList.add('explorer-entry');
			container.appendChild(span);
			return { span };
		}
		if (templateId === Renderer.EDITABLE_TEMPLATE_ID) {
			const input = document.createElement('input');
			input.type = 'text';
			input.classList.add('explorer-entry', 'editable');
			container.appendChild(input);
			const data: { input: HTMLInputElement, element?: IEntry } = { input };
			input.addEventListener('keydown', ev => {
				if (ev.keyCode === 13 && input.value) {
					input.disabled = true;
					const name = input.value;
					const uri = `${data.element.parent.uri}/${name}`;
					fetch(consoleUri + uri, {
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ isFolder: data.element.isFolder }),
						method: 'POST'
					})
						.catch(console.error)
						.then(() => {
							this.dataSource.newEntryParentUri = null;
							tree.refresh(data.element.parent);
							if (!data.element.isFolder) {
								openEditor(uri, name);
							}
						});
				} else if (ev.keyCode === 27) {
					this.dataSource.newEntryParentUri = null;
					tree.refresh(data.element.parent);
				}
			});
			input.addEventListener('blur', ev => {
				if (!input.disabled && this.dataSource.newEntryParentUri) {
					this.dataSource.newEntryParentUri = null;
					tree.refresh(data.element.parent);
				}
			});
			return data;
		}
		throw new Error('Unknown template id');
	}

	renderElement(tree, element, templateId, templateData) {
		if (templateId === Renderer.TEMPLATE_ID) {
			templateData.span.textContent = element.name;
		} else if (templateId === Renderer.EDITABLE_TEMPLATE_ID) {
			templateData.input.disabled = false;
			templateData.input.value = element.name;
			templateData.element = element;
			templateData.input.focus();
		}
	}

	disposeTemplate(tree, templateId, templateData) {
	}
}

class Controller implements IController {

	onClick(tree, element, event) {
		if (element.isEditable) {
			return true;
		}
		tree.setSelection([element]);
		if (element.isFolder) {
			tree.toggleExpansion(element);
			return true;
		}
		openEditor(element.uri, element.name, true);
		return true;
	}

	onContextMenu(tree, element, event) {
		return false;
	}

	onTap(tree, element, event) {
		return false;
	}

	onKeyDown(tree, event) {
		return false;
	}

	onKeyUp(tree, event) {
		return false;
	}
}

class Sorter implements ISorter {

	compare(tree, element, otherElement) {
		if (element.isFolder && !otherElement.isFolder) {
			return -1;
		}
		if (!element.isFolder && otherElement.isFolder) {
			return 1;
		}
		return element.name.localeCompare(otherElement.name);
	}
}

function openEditor(fileUri: string, fileName: string, preserveFocus?: boolean) {
	document.dispatchEvent(new CustomEvent('show', {
		detail: {
			component: 'editor',
			arguments: {
				fileUri,
				fileName,
				preserveFocus
			}
		}
	}));
}

const dataSource = new DataSource();

const tree = new Tree(document.getElementById('editor-explorer'), {
	dataSource,
	renderer: new Renderer(dataSource),
	controller: new Controller(),
	sorter: new Sorter()
}, {
		listActiveSelectionBackground: Color.fromHex('#094771')
	});

export function show(folderUri: string) {
	document.getElementById('editor-explorer')
		.style.display = null;
	if (!tree.getInput() || folderUri !== tree.getInput().uri) {
		const root: IEntry = {
			uri: folderUri,
			name: '<root>',
			isFolder: true,
		};
		tree.setInput(root);
	}
}

export function newFile() {
	newEntry(false);
}

export function newFolder() {
	newEntry(true);
}

function newEntry(isFolder: boolean) {
	const selected = tree.getSelection()[0];
	const parent = selected ? (selected.isFolder ? selected : selected.parent) : tree.getInput();
	dataSource.newEntryParentUri = parent.uri;
	dataSource.newEntryIsFolder = isFolder;
	if (parent && !tree.isExpanded(parent)) {
		tree.expand(parent);
	}
	tree.refresh(parent);
}

export function refresh() {
	tree.refresh();
}

export function layout() {
	tree.layout();
}

let consoleUri: string;
export function setConsoleUri(uri: string) {
	consoleUri = uri;
}