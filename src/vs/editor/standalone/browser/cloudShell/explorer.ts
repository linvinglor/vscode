/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Tree } from 'vs/base/parts/tree/browser/treeImpl';
import { IDataSource, IRenderer, IController, ISorter } from 'vs/base/parts/tree/browser/tree';
import { TPromise } from 'vs/base/common/winjs.base';

interface IEntry {
	uri: string;
	name: string;
	isFolder: boolean;
	parent?: IEntry;
}

class DataSource implements IDataSource {
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

	getHeight(tree, element) {
		return 22;
	}
	getTemplateId(tree, element) {
		return 'explorer_entry';
	}

	renderTemplate(tree, templateId, container) {
		const span = document.createElement('span');
		span.classList.add('explorer-entry');
		container.appendChild(span);
		return span;
	}

	renderElement(tree, element, templateId, templateData) {
		templateData.textContent = element.name;
	}

	disposeTemplate(tree, templateId, templateData) {
	}
}

class Controller implements IController {

	onClick(tree, element, event) {
		if (element.isFolder) {
			tree.toggleExpansion(element);
			return true;
		}
		document.dispatchEvent(new CustomEvent('show', {
			detail: {
				component: 'editor',
				arguments: {
					fileUri: element.uri,
					fileName: element.name
				}
			}
		}));
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

const tree = new Tree(document.getElementById('editor-explorer'), {
	dataSource: new DataSource(),
	renderer: new Renderer(),
	controller: new Controller(),
	sorter: new Sorter()
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