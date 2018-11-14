/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Async from 'vs/base/common/async';
import * as Types from 'vs/base/common/types';
import * as Objects from 'vs/base/common/objects';

import { ProblemMatcher, ProblemMatcherRegistry } from 'vs/workbench/parts/problemMatching/common/problemMatcher';
import { ITerminalInstance } from 'vs/workbench/parts/terminal/common/terminal';
import { WatchingProblemCollector, ProblemCollectorEventKind } from 'vs/workbench/parts/problemMatching/common/problemCollectors';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { CommandString } from 'vs/workbench/parts/tasks/common/tasks';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { ConfigurationResolverUtils } from 'vs/workbench/services/configurationResolver/common/configurationResolverUtils';

class VariableResolver {

	constructor(public workspaceFolder: IWorkspaceFolder, private _values: Map<string, string>, private _service: IConfigurationResolverService | undefined) {
	}
	resolve(value: string): string {
		return value.replace(/\$\{(.*?)\}/g, (match: string, variable: string) => {
			let result = this._values.get(match);
			if (result) {
				return result;
			}
			if (this._service) {
				return this._service.resolve(this.workspaceFolder, match);
			}
			return match;
		});
	}
}

export class TerminalProblemAttacher {
	constructor(private _workspaceFolder: IWorkspaceFolder,
		private markerService: IMarkerService,
		private modelService: IModelService,
		private configurationResolverService: IConfigurationResolverService) {

	}


	public attachProblemMatcherToTerminal(terminal: ITerminalInstance, problemMatchers: ProblemMatcher[]) {
		const variables = new Set<string>();
		this.collectMatcherVariables(variables, problemMatchers);
		let result = new Map<string, string>();
		variables.forEach(variable => {
			result.set(variable, this.configurationResolverService.resolve(this._workspaceFolder, variable));
		});
		const resolver = new VariableResolver(this._workspaceFolder, result, this.configurationResolverService);
		const resolvedMatchers = this.resolveMatchers(resolver, problemMatchers);

		let startStopMatchers: ProblemMatcher[];
		let watchingMatchers: ProblemMatcher[];

		resolvedMatchers.forEach(matcher => {
			if (matcher.watching) {
				watchingMatchers.push(matcher);
			} else {
				startStopMatchers.push(matcher);
			}
		});

		this.attachWatchingMatcher(watchingMatchers, terminal);
	}

	public attachWatchingMatcher(resolvedMatchers: ProblemMatcher[], terminal: ITerminalInstance) {
		let watchingProblemMatcher = new WatchingProblemCollector(resolvedMatchers, this.markerService, this.modelService);
		let toDispose: IDisposable[] = [];
		let eventCounter: number = 0;
		toDispose.push(watchingProblemMatcher.onDidStateChange((event) => {
			if (event.kind === ProblemCollectorEventKind.BackgroundProcessingBegins) {
				eventCounter++;
				// this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Active, task));
			} else if (event.kind === ProblemCollectorEventKind.BackgroundProcessingEnds) {
				eventCounter--;
				//this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Inactive, task));
				if (eventCounter === 0) {
					// let reveal = task.command.presentation.reveal;
					// if ((reveal === RevealKind.Silent) && (watchingProblemMatcher.numberOfMatches > 0) && (watchingProblemMatcher.maxMarkerSeverity >= MarkerSeverity.Error)) {
					// 	this.terminalService.setActiveInstance(terminal);
					// 	this.terminalService.showPanel(false);
					// }
				}
			}
		}));
		watchingProblemMatcher.aboutToStart();
		let delayer: Async.Delayer<any> = undefined;

		let processStartedSignaled = false;
		terminal.processReady.then(() => {
			if (!processStartedSignaled) {
				//this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, terminal.processId));
				processStartedSignaled = true;
			}
		}, (_error) => {
			// The process never got ready. Need to think how to handle this.
		});
		//this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Start, task));
		const onData = terminal.onLineData((line) => {
			watchingProblemMatcher.processLine(line);
			if (!delayer) {
				delayer = new Async.Delayer(3000);
			}
			delayer.trigger(() => {
				watchingProblemMatcher.forceDelivery();
				delayer = undefined;
			});
		});
		const onExit = terminal.onExit((exitCode) => {
			onData.dispose();
			onExit.dispose();
			// let key = Task.getMapKey(task);
			// delete this.activeTasks[key];
			// this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Changed));
			// switch (task.command.presentation.panel) {
			// 	case PanelKind.Dedicated:
			// 		this.sameTaskTerminals[key] = terminal.id.toString();
			// 		break;
			// 	case PanelKind.Shared:
			// 		this.idleTaskTerminals.set(key, terminal.id.toString(), Touch.AsOld);
			// 		break;
			// }
			// let reveal = task.command.presentation.reveal;
			// if ((reveal === RevealKind.Silent) && ((exitCode !== 0) || (watchingProblemMatcher.numberOfMatches > 0) && (watchingProblemMatcher.maxMarkerSeverity >= MarkerSeverity.Error))) {
			// 	this.terminalService.setActiveInstance(terminal);
			// 	this.terminalService.showPanel(false);
			// }
			watchingProblemMatcher.done();
			watchingProblemMatcher.dispose();
			if (!processStartedSignaled) {
				// this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, terminal.processId));
				processStartedSignaled = true;
			}
			// this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessEnded, task, exitCode));
			// for (let i = 0; i < eventCounter; i++) {
			// 	let event = TaskEvent.create(TaskEventKind.Inactive, task);
			// 	this._onDidStateChange.fire(event);
			// }
			eventCounter = 0;
			// this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.End, task));
			toDispose = dispose(toDispose);
			toDispose = null;
		});
	}

	// private resolveVariables(resolver: VariableResolver, value: string[]): string[];
	// private resolveVariables(resolver: VariableResolver, value: CommandString[]): CommandString[];
	// private resolveVariables(resolver: VariableResolver, value: CommandString[]): CommandString[] {
	// 	return value.map(s => this.resolveVariable(resolver, s));
	// }

	private resolveMatchers(resolver: VariableResolver, values: (string | ProblemMatcher)[]): ProblemMatcher[] {
		if (values === void 0 || values === null || values.length === 0) {
			return [];
		}
		let result: ProblemMatcher[] = [];
		values.forEach((value) => {
			let matcher: ProblemMatcher;
			if (Types.isString(value)) {
				if (value[0] === '$') {
					matcher = ProblemMatcherRegistry.get(value.substring(1));
				} else {
					matcher = ProblemMatcherRegistry.get(value);
				}
			} else {
				matcher = value;
			}
			if (!matcher) {
				// TODO: this.outputChannel.append(nls.localize('unkownProblemMatcher', 'Problem matcher {0} can\'t be resolved. The matcher will be ignored'));
				return;
			}
			// let taskSystemInfo: TaskSystemInfo = resolver.taskSystemInfo;
			let hasFilePrefix = matcher.filePrefix !== void 0;
			// let hasUriProvider = taskSystemInfo !== void 0 && taskSystemInfo.uriProvider !== void 0;
			if (!hasFilePrefix) { // && !hasUriProvider) {
				result.push(matcher);
			} else {
				let copy = Objects.deepClone(matcher);
				// if (hasUriProvider) {
				// 	// copy.uriProvider = taskSystemInfo.uriProvider;
				// }
				if (hasFilePrefix) {
					copy.filePrefix = this.resolveVariable(resolver, copy.filePrefix);
				}
				result.push(copy);
			}
		});
		return result;
	}

	private resolveVariable(resolver: VariableResolver, value: string): string;
	private resolveVariable(resolver: VariableResolver, value: CommandString): CommandString;
	private resolveVariable(resolver: VariableResolver, value: CommandString): CommandString {
		// TODO@Dirk Task.getWorkspaceFolder should return a WorkspaceFolder that is defined in workspace.ts
		if (Types.isString(value)) {
			return resolver.resolve(value);
		} else {
			return {
				value: resolver.resolve(value.value),
				quoting: value.quoting
			};
		}
	}

	private collectMatcherVariables(variables: Set<string>, values: (string | ProblemMatcher)[]): void {
		if (values === void 0 || values === null || values.length === 0) {
			return;
		}
		values.forEach((value) => {
			let matcher: ProblemMatcher;
			if (Types.isString(value)) {
				if (value[0] === '$') {
					matcher = ProblemMatcherRegistry.get(value.substring(1));
				} else {
					matcher = ProblemMatcherRegistry.get(value);
				}
			} else {
				matcher = value;
			}
			if (matcher && matcher.filePrefix) {
				ConfigurationResolverUtils.collectVariables(variables, matcher.filePrefix);
			}
		});
	}
}