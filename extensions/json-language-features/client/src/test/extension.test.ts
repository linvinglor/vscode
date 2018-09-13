/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as vscode from 'vscode';
import 'mocha';

import * as path from 'path';

// Defines a Mocha test suite to group tests of similar kind together
suite('JSON Extension Tests', async function () {

    const testFile = path.resolve(path.join(__dirname, '../src/test/fixtures/test-color-theme.json'));
    const docUri = vscode.Uri.file(testFile);

    const doc = await vscode.workspace.openTextDocument(docUri);
    await vscode.window.showTextDocument(doc);

    // Defines a Mocha unit test
    test('Hover', async function () {
        const alignRange = find(doc, 'tokenColors');

        const result = (await vscode.commands.executeCommand('vscode.executeHoverProvider', docUri, alignRange.start)) as vscode.Hover[];
        assert.equal(result[0].contents[0], 'Colors for syntax highlighting');
    });
});

function find(doc: vscode.TextDocument, str: string) {
    const index = doc.getText().indexOf(str);
    return new vscode.Range(doc.positionAt(index), doc.positionAt(index + str.length));
}