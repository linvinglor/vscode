/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IIssueService, IssueReporterData, ProcessExplorerData, SystemInfo } from 'vs/platform/issue/common/issue';

export interface IIssueChannel extends IChannel {
	call(command: 'openIssueReporter', arg: IssueReporterData): TPromise<void>;
	call(command: 'getStatusInfo'): TPromise<any>;
	call(command: string, arg?: any): TPromise<any>;
}

export class IssueChannel implements IIssueChannel {

	constructor(private service: IIssueService) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'openIssueReporter':
				return this.service.openReporter(arg);
			case 'openProcessExplorer':
				return this.service.openProcessExplorer(arg);
			case 'getSystemInfo':
				return this.service.getSystemInfo();
		}
		return undefined;
	}
}

export class IssueChannelClient implements IIssueService {

	_serviceBrand: any;

	constructor(private channel: IIssueChannel) { }

	openReporter(data: IssueReporterData): TPromise<void> {
		return this.channel.call('openIssueReporter', data);
	}

	openProcessExplorer(data: ProcessExplorerData): TPromise<void> {
		return this.channel.call('openProcessExplorer', data);
	}

	getSystemInfo(): TPromise<SystemInfo> {
		return this.channel.call('getSystemInfo');
	}
}