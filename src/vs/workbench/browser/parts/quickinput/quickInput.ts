/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./quickInput';
import { Component } from 'vs/workbench/common/component';
import { IQuickInputService, IQuickPickItem, IPickOptions, IInputOptions, IQuickNavigateConfiguration, IQuickPick, IQuickInput, IQuickInputButton, IInputBox } from 'vs/platform/quickinput/common/quickInput';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import * as dom from 'vs/base/browser/dom';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { contrastBorder, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { SIDE_BAR_BACKGROUND, SIDE_BAR_FOREGROUND } from 'vs/workbench/common/theme';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { TPromise } from 'vs/base/common/winjs.base';
import { CancellationToken } from 'vs/base/common/cancellation';
import { QuickInputList } from './quickInputList';
import { QuickInputBox } from './quickInputBox';
import { KeyCode } from 'vs/base/common/keyCodes';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CLOSE_ON_FOCUS_LOST_CONFIG } from 'vs/workbench/browser/quickopen';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { attachBadgeStyler, attachProgressBarStyler, attachButtonStyler } from 'vs/platform/theme/common/styler';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { chain, debounceEvent, Emitter, Event } from 'vs/base/common/event';
import { Button } from 'vs/base/browser/ui/button/button';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { onUnexpectedError, canceled } from 'vs/base/common/errors';
import Severity from 'vs/base/common/severity';
import { IEditorGroupsService } from 'vs/workbench/services/group/common/editorGroupsService';
import { IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ICommandAndKeybindingRule, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { inQuickOpenContext } from 'vs/workbench/browser/parts/quickopen/quickopen';

const $ = dom.$;

type InputParameters = PickOneParameters | PickManyParameters | TextInputParameters;

type InputResult<P extends InputParameters> =
	P extends PickOneParameters<infer T> ? T :
	P extends PickManyParameters<infer T> ? T[] :
	P extends TextInputParameters ? string :
	never;

interface BaseInputParameters {
	readonly type: 'pickOne' | 'pickMany' | 'textInput';
	readonly ignoreFocusLost?: boolean;
}

interface PickParameters<T extends IQuickPickItem = IQuickPickItem> extends BaseInputParameters {
	readonly type: 'pickOne' | 'pickMany';
	readonly picks: TPromise<T[]>;
	readonly matchOnDescription?: boolean;
	readonly matchOnDetail?: boolean;
	readonly placeholder?: string;
}

interface PickOneParameters<T extends IQuickPickItem = IQuickPickItem> extends PickParameters<T> {
	readonly type: 'pickOne';
}

interface PickManyParameters<T extends IQuickPickItem = IQuickPickItem> extends PickParameters<T> {
	readonly type: 'pickMany';
}

interface TextInputParameters extends BaseInputParameters {
	readonly type: 'textInput';
	readonly value?: string;
	readonly valueSelection?: [number, number];
	readonly prompt?: string;
	readonly placeHolder?: string;
	readonly password?: boolean;
	readonly validateInput?: (input: string) => TPromise<string>;
}

interface QuickInputUI {
	container: HTMLElement;
	checkAll: HTMLInputElement;
	inputBox: QuickInputBox;
	count: CountBadge;
	message: HTMLElement;
	progressBar: ProgressBar;
	list: QuickInputList;
	onDidAccept: Event<void>;
	ignoreFocusOut: boolean;
	show(controller: QuickInput): void;
	hide(): void;
	setVisibilities(visibilities: Visibilities): void;
	close(ok?: true | Thenable<never>): void;
}

type Visibilities = { [k in keyof QuickInputUI]?: boolean; } & { ok?: boolean; };

interface InputController<R> {
	readonly showUI: Visibilities;
	readonly result: TPromise<R>;
	readonly ready: TPromise<void>;
	readonly resolve: (ok?: true | Thenable<never>) => void | TPromise<void>;
}

class PickOneController<T extends IQuickPickItem> implements InputController<T> {
	public showUI = { inputBox: true, list: true };
	public result: TPromise<T>;
	public ready: TPromise<void>;
	public resolve: (ok?: true | Thenable<never>) => void;
	public progress: (value: T) => void;
	private closed = false;
	private quickNavigate = false;
	private disposables: IDisposable[] = [];

	constructor(private ui: QuickInputUI, parameters: PickOneParameters<T>) {
		this.result = new TPromise<T>((resolve, reject, progress) => {
			this.resolve = ok => resolve(ok === true ? <T>ui.list.getFocusedElements()[0] : ok);
			this.progress = progress;
		});
		this.result.then(() => this.dispose());

		ui.inputBox.value = '';
		ui.inputBox.placeholder = parameters.placeholder || '';
		ui.list.matchOnDescription = parameters.matchOnDescription;
		ui.list.matchOnDetail = parameters.matchOnDetail;
		ui.list.setElements([]);

		this.ready = parameters.picks.then(elements => {
			if (this.closed) {
				return;
			}

			ui.list.setElements(elements);
			ui.list.filter(ui.inputBox.value);
			ui.list.focus('First');

			this.disposables.push(
				ui.list.onDidChangeSelection(elements => {
					if (elements[0]) {
						ui.close(true);
					}
				}),
				ui.inputBox.onDidChange(value => {
					ui.list.filter(value);
					ui.list.focus('First');
				}),
				ui.inputBox.onKeyDown(event => {
					switch (event.keyCode) {
						case KeyCode.DownArrow:
							ui.list.focus('Next');
							break;
						case KeyCode.UpArrow:
							ui.list.focus('Previous');
							break;
					}
				})
			);
		});
	}

	configureQuickNavigate(quickNavigate: IQuickNavigateConfiguration) {
		// TODO: Add to new implementation.
		if (this.quickNavigate) {
			return;
		}
		this.quickNavigate = true;

		this.disposables.push(dom.addDisposableListener(this.ui.container, dom.EventType.KEY_UP, (e: KeyboardEvent) => {
			const keyboardEvent: StandardKeyboardEvent = new StandardKeyboardEvent(e as KeyboardEvent);
			const keyCode = keyboardEvent.keyCode;

			// Select element when keys are pressed that signal it
			const quickNavKeys = quickNavigate.keybindings;
			const wasTriggerKeyPressed = keyCode === KeyCode.Enter || quickNavKeys.some(k => {
				const [firstPart, chordPart] = k.getParts();
				if (chordPart) {
					return false;
				}

				if (firstPart.shiftKey && keyCode === KeyCode.Shift) {
					if (keyboardEvent.ctrlKey || keyboardEvent.altKey || keyboardEvent.metaKey) {
						return false; // this is an optimistic check for the shift key being used to navigate back in quick open
					}

					return true;
				}

				if (firstPart.altKey && keyCode === KeyCode.Alt) {
					return true;
				}

				if (firstPart.ctrlKey && keyCode === KeyCode.Ctrl) {
					return true;
				}

				if (firstPart.metaKey && keyCode === KeyCode.Meta) {
					return true;
				}

				return false;
			});

			if (wasTriggerKeyPressed) {
				this.ui.close(true);
			}
		}));
	}

	private dispose() {
		this.closed = true;
		this.disposables = dispose(this.disposables);
	}
}

class PickManyController<T extends IQuickPickItem> implements InputController<T[]> {
	public showUI = { checkAll: true, inputBox: true, count: true, ok: true, list: true };
	public result: TPromise<T[]>;
	public ready: TPromise<void>;
	public resolve: (ok?: true | Thenable<never>) => void;
	public progress: (value: T) => void;
	private closed = false;
	private disposables: IDisposable[] = [];

	constructor(ui: QuickInputUI, parameters: PickManyParameters<T>) {
		this.result = new TPromise<T[]>((resolve, reject, progress) => {
			this.resolve = ok => resolve(ok === true ? <T[]>ui.list.getCheckedElements() : ok);
			this.progress = progress;
		});
		this.result.then(() => this.dispose());

		ui.inputBox.value = '';
		ui.inputBox.placeholder = parameters.placeholder || '';
		ui.list.matchOnDescription = parameters.matchOnDescription;
		ui.list.matchOnDetail = parameters.matchOnDetail;
		ui.list.setElements([]);
		ui.checkAll.checked = ui.list.getAllVisibleChecked();
		ui.count.setCount(ui.list.getCheckedCount());

		this.ready = parameters.picks.then(elements => {
			if (this.closed) {
				return;
			}

			ui.list.setElements(elements);
			ui.list.filter(ui.inputBox.value);
			ui.checkAll.checked = ui.list.getAllVisibleChecked();
			ui.count.setCount(ui.list.getCheckedCount());

			this.disposables.push(
				ui.inputBox.onDidChange(value => {
					ui.list.filter(value);
				}),
				ui.inputBox.onKeyDown(event => {
					switch (event.keyCode) {
						case KeyCode.DownArrow:
							ui.list.focus('First');
							ui.list.domFocus();
							break;
						case KeyCode.UpArrow:
							ui.list.focus('Last');
							ui.list.domFocus();
							break;
					}
				})
			);
		});
	}

	private dispose() {
		this.closed = true;
		this.disposables = dispose(this.disposables);
	}
}

class TextInputController implements InputController<string> {
	public showUI = { inputBox: true, message: true };
	public result: TPromise<string>;
	public ready = TPromise.as(null);
	public resolveResult: (string) => void;
	private validationValue: string;
	private validation: TPromise<string>;
	private defaultMessage: string;
	private disposables: IDisposable[] = [];

	constructor(private ui: QuickInputUI, private parameters: TextInputParameters) {
		this.result = new TPromise<string>((resolve, reject, progress) => {
			this.resolveResult = resolve;
		});
		this.result.then(() => this.dispose());

		ui.inputBox.value = parameters.value || '';
		const selection = parameters.valueSelection;
		ui.inputBox.select(selection && { start: selection[0], end: selection[1] });
		ui.inputBox.placeholder = parameters.placeHolder || '';
		this.defaultMessage = parameters.prompt
			? localize('inputModeEntryDescription', "{0} (Press 'Enter' to confirm or 'Escape' to cancel)", parameters.prompt)
			: localize('inputModeEntry', "Press 'Enter' to confirm your input or 'Escape' to cancel");
		ui.message.textContent = this.defaultMessage;
		ui.inputBox.password = parameters.password;

		if (parameters.validateInput) {
			const onDidChange = debounceEvent(ui.inputBox.onDidChange, (last, cur) => cur, 100);
			this.disposables.push(onDidChange(() => this.didChange()));
			if (ui.inputBox.value) {
				// Replicating old behavior: only fire if value is not empty.
				this.didChange();
			}
		}
	}

	didChange() {
		this.updatedValidation()
			.then(validationError => {
				this.ui.message.textContent = validationError || this.defaultMessage;
				this.ui.inputBox.showDecoration(validationError ? Severity.Error : Severity.Ignore);
			})
			.then(null, onUnexpectedError);
	}

	resolve(ok?: true | Thenable<never>) {
		if (ok === true) {
			return this.updatedValidation()
				.then(validationError => {
					if (validationError) {
						throw canceled();
					}
					this.resolveResult(this.ui.inputBox.value);
				});
		} else {
			this.resolveResult(ok);
		}
		return null;
	}

	private updatedValidation() {
		if (this.parameters.validateInput) {
			const value = this.ui.inputBox.value;
			if (value !== this.validationValue) {
				this.validationValue = value;
				this.validation = this.parameters.validateInput(value)
					.then(validationError => {
						if (this.validationValue !== value) {
							throw canceled();
						}
						return validationError;
					});
			}
		} else if (!this.validation) {
			this.validation = TPromise.as(null);
		}
		return this.validation;
	}

	private dispose() {
		this.disposables = dispose(this.disposables);
	}
}

export class QuickInputService extends Component implements IQuickInputService {

	public _serviceBrand: any;

	private static readonly ID = 'workbench.component.quickinput';
	private static readonly MAX_WIDTH = 600; // Max total width of quick open widget

	private layoutDimensions: dom.Dimension;
	private filterContainer: HTMLElement;
	private countContainer: HTMLElement;
	private okContainer: HTMLElement;
	private ui: QuickInputUI;
	private ready = false;
	private inQuickOpenWidgets: Record<string, boolean> = {};
	private inQuickOpenContext: IContextKey<boolean>;
	private onDidAcceptEmitter = new Emitter<void>();

	private controller: InputController<any>;
	private controller2: QuickInput;

	constructor(
		@IEnvironmentService private environmentService: IEnvironmentService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPartService private partService: IPartService,
		@IQuickOpenService private quickOpenService: IQuickOpenService,
		@IEditorGroupsService private editorGroupService: IEditorGroupsService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService
	) {
		super(QuickInputService.ID, themeService);
		this.inQuickOpenContext = new RawContextKey<boolean>('inQuickOpen', false).bindTo(contextKeyService);
		this.toUnbind.push(
			this.quickOpenService.onShow(() => this.inQuickOpen('quickOpen', true)),
			this.quickOpenService.onHide(() => this.inQuickOpen('quickOpen', false)),
			this.onDidAcceptEmitter
		);
	}

	private inQuickOpen(widget: 'quickInput' | 'quickOpen', open: boolean) {
		if (open) {
			this.inQuickOpenWidgets[widget] = true;
		} else {
			delete this.inQuickOpenWidgets[widget];
		}
		if (Object.keys(this.inQuickOpenWidgets).length) {
			if (!this.inQuickOpenContext.get()) {
				this.inQuickOpenContext.set(true);
			}
		} else {
			if (this.inQuickOpenContext.get()) {
				this.inQuickOpenContext.reset();
			}
		}
	}

	private create() {
		if (this.ui) {
			return;
		}

		const workbench = document.getElementById(this.partService.getWorkbenchElementId());
		const container = dom.append(workbench, $('.quick-input-widget'));
		container.tabIndex = -1;
		container.style.display = 'none';

		const headerContainer = dom.append(container, $('.quick-input-header'));

		const checkAll = <HTMLInputElement>dom.append(headerContainer, $('input.quick-input-check-all'));
		checkAll.type = 'checkbox';
		this.toUnbind.push(dom.addStandardDisposableListener(checkAll, dom.EventType.CHANGE, e => {
			const checked = checkAll.checked;
			list.setAllVisibleChecked(checked);
		}));
		this.toUnbind.push(dom.addDisposableListener(checkAll, dom.EventType.CLICK, e => {
			if (e.x || e.y) { // Avoid 'click' triggered by 'space'...
				inputBox.setFocus();
			}
		}));

		this.filterContainer = dom.append(headerContainer, $('.quick-input-filter'));

		const inputBox = new QuickInputBox(this.filterContainer);
		this.toUnbind.push(inputBox);

		this.countContainer = dom.append(this.filterContainer, $('.quick-input-count'));
		const count = new CountBadge(this.countContainer, { countFormat: localize({ key: 'quickInput.countSelected', comment: ['This tells the user how many items are selected in a list of items to select from. The items can be anything.'] }, "{0} Selected") });
		this.toUnbind.push(attachBadgeStyler(count, this.themeService));

		this.okContainer = dom.append(headerContainer, $('.quick-input-action'));
		const ok = new Button(this.okContainer);
		attachButtonStyler(ok, this.themeService);
		ok.label = localize('ok', "OK");
		this.toUnbind.push(ok.onDidClick(e => {
			if (this.controller) {
				if (this.ready) {
					this.close(true);
				}
			} else {
				this.onDidAcceptEmitter.fire(); // TODO: make single-select QuickPick exclusively use Accept?
			}
		}));

		const message = dom.append(container, $('.quick-input-message'));

		const progressBar = new ProgressBar(container);
		dom.addClass(progressBar.getContainer(), 'quick-input-progress');
		this.toUnbind.push(attachProgressBarStyler(progressBar, this.themeService));

		const list = this.instantiationService.createInstance(QuickInputList, container);
		this.toUnbind.push(list);
		this.toUnbind.push(list.onChangedAllVisibleChecked(checked => {
			checkAll.checked = checked;
		}));
		this.toUnbind.push(list.onChangedCheckedCount(c => {
			count.setCount(c);
		}));
		this.toUnbind.push(list.onLeave(() => {
			// Defer to avoid the input field reacting to the triggering key.
			setTimeout(() => {
				inputBox.setFocus();
				list.clearFocus();
			}, 0);
		}));
		this.toUnbind.push(
			chain(list.onDidChangeFocus)
				.map(e => e[0])
				.filter(e => !!e)
				.latch()
				.on(e => {
					if (this.controller instanceof PickOneController || this.controller instanceof PickManyController) {
						this.controller.progress(e);
					}
				})
		);

		this.toUnbind.push(dom.addDisposableListener(container, 'focusout', (e: FocusEvent) => {
			if (e.relatedTarget === container) {
				(<HTMLElement>e.target).focus();
				return;
			}
			for (let element = <Element>e.relatedTarget; element; element = element.parentElement) {
				if (element === container) {
					return;
				}
			}
			if (!this.ui.ignoreFocusOut && !this.environmentService.args['sticky-quickopen'] && this.configurationService.getValue(CLOSE_ON_FOCUS_LOST_CONFIG)) {
				if (this.controller) {
					this.close(undefined, true);
				} else {
					this.hide2(true);
				}
			}
		}));
		this.toUnbind.push(dom.addDisposableListener(container, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			switch (event.keyCode) {
				case KeyCode.Enter:
					dom.EventHelper.stop(e, true);
					if (this.controller) {
						if (this.ready) {
							this.close(true);
						}
					} else {
						this.onDidAcceptEmitter.fire();
					}
					break;
				case KeyCode.Escape:
					dom.EventHelper.stop(e, true);
					if (this.controller) {
						this.close();
					} else {
						this.hide2();
					}
					break;
				case KeyCode.Tab:
					if (!event.altKey && !event.ctrlKey && !event.metaKey) {
						const inputs = [].slice.call(container.querySelectorAll('input'))
							.filter(input => input.style.display !== 'none');
						if (event.shiftKey && event.target === inputs[0]) {
							dom.EventHelper.stop(e, true);
							inputs[inputs.length - 1].focus();
						} else if (!event.shiftKey && event.target === inputs[inputs.length - 1]) {
							dom.EventHelper.stop(e, true);
							inputs[0].focus();
						}
					}
					break;
			}
		}));

		this.toUnbind.push(this.quickOpenService.onShow(() => this.controller ? this.close() : this.hide2()));

		this.ui = {
			container,
			checkAll,
			inputBox,
			count,
			message,
			progressBar,
			list,
			onDidAccept: this.onDidAcceptEmitter.event,
			ignoreFocusOut: false,
			show: controller => this.show2(controller),
			hide: () => this.hide2(),
			setVisibilities: visibilities => this.setVisibilities(visibilities),
			close: ok => this.close(ok)
		};
		this.updateStyles();
	}

	private close(ok?: true | Thenable<never>, focusLost?: boolean) {
		if (!this.isDisplayed()) {
			return TPromise.as(undefined);
		}
		if (this.controller) {
			const resolved = this.controller.resolve(ok);
			if (resolved) {
				const result = resolved
					.then(() => {
						this.hide(focusLost);
					});
				result.then(null, onUnexpectedError);
				return result;
			}
		}
		this.hide(focusLost);
		return TPromise.as(undefined);
	}

	private hide(focusLost?: boolean) {
		this.inQuickOpen('quickInput', false);
		this.ui.container.style.display = 'none';
		if (!focusLost) {
			this.editorGroupService.activeGroup.focus();
		}
	}

	private hide2(focusLost?: boolean) {
		const controller = this.controller2;
		if (controller) {
			this.controller2 = null;
			this.hide(focusLost);
			controller.doHide();
		}
	}

	pick<T extends IQuickPickItem, O extends IPickOptions>(picks: TPromise<T[]>, options: O = <O>{}, token: CancellationToken = CancellationToken.None): TPromise<O extends { canPickMany: true } ? T[] : T> {
		return new TPromise<O extends { canPickMany: true } ? T[] : T>((resolve, reject, progress) => {
			if (token.isCancellationRequested) {
				resolve(undefined);
				return;
			}
			const input = this.createQuickPick();
			const disposables = [
				input,
				input.onDidAccept(() => {
					if (input.canSelectMany) {
						resolve(<any>input.selectedItems); // TODO: generify interface to use T extends IQuickPickItem
						input.hide();
					} else {
						const result = input.activeItems[0];
						if (result) {
							resolve(<any>result);
							input.hide();
						}
					}
				}),
				input.onDidChangeActive(items => {
					const focused = items[0];
					if (focused) {
						progress(focused);
					}
				}),
				input.onDidChangeSelection(items => {
					if (!input.canSelectMany) {
						const result = items[0];
						if (result) {
							resolve(<any>result);
							input.hide();
						}
					}
				}),
				token.onCancellationRequested(() => {
					input.hide();
				}),
				input.onDidHide(() => {
					dispose(disposables);
					resolve(undefined);
				}),
			];
			input.canSelectMany = options.canPickMany;
			input.placeholder = options.placeHolder;
			input.ignoreFocusOut = options.ignoreFocusLost;
			input.matchOnDescription = options.matchOnDescription;
			input.matchOnDetail = options.matchOnDetail;
			input.busy = true;
			picks.then(items => {
				input.busy = false;
				input.items = items;
			});
			input.show();
			picks.then(null, err => {
				reject(err);
				input.hide();
			});
		});
	}

	input(options: IInputOptions = {}, token: CancellationToken = CancellationToken.None): TPromise<string> {
		return new TPromise<string>((resolve, reject) => {
			if (token.isCancellationRequested) {
				resolve(undefined);
				return;
			}
			const input = this.createInputBox();
			const validateInput = options.validateInput || (() => TPromise.as(undefined));
			const onDidValueChange = debounceEvent(input.onDidChangeValue, (last, cur) => cur, 100);
			let validationValue: string;
			let validation = TPromise.as('');
			const disposables = [
				input,
				onDidValueChange(value => {
					if (value !== validationValue) {
						validation = TPromise.wrap(validateInput(value));
					}
					validation.then(result => {
						input.validationMessage = result;
					});
				}),
				input.onDidAccept(() => {
					const value = input.value;
					if (value !== validationValue) {
						validation = TPromise.wrap(validateInput(value));
					}
					validation.then(result => {
						if (!result) {
							resolve(value);
							input.hide();
						}
					});
				}),
				token.onCancellationRequested(() => {
					input.hide();
				}),
				input.onDidHide(() => {
					dispose(disposables);
					resolve(undefined);
				}),
			];
			input.value = options.value;
			input.valueSelection = options.valueSelection;
			input.prompt = options.prompt;
			input.placeholder = options.placeHolder;
			input.password = options.password;
			input.ignoreFocusOut = options.ignoreFocusLost;
			input.show();
		});
	}

	createQuickPick(): IQuickPick {
		this.create();
		return new QuickPick(this.ui);
	}

	createInputBox(): IInputBox {
		this.create();
		return new InputBox(this.ui);
	}

	show<P extends InputParameters>(parameters: P, token: CancellationToken = CancellationToken.None): TPromise<InputResult<P>> {
		this.create();
		this.quickOpenService.close();
		if (this.controller) {
			this.controller.resolve();
		}

		this.ui.container.setAttribute('data-type', parameters.type);

		this.ui.ignoreFocusOut = parameters.ignoreFocusLost;

		this.ui.progressBar.stop();
		this.ready = false;

		this.controller = this.createController(parameters);
		this.setVisibilities(this.controller.showUI);
		this.ui.inputBox.showDecoration(Severity.Ignore);

		if (this.ui.container.style.display === 'none') {
			this.inQuickOpen('quickInput', true);
		}
		this.ui.container.style.display = '';
		this.updateLayout();
		this.ui.inputBox.setFocus();

		const d = token.onCancellationRequested(() => this.close());
		this.controller.result.then(() => d.dispose(), () => d.dispose());

		const wasController = this.controller;

		const delay = TPromise.timeout(800);
		delay.then(() => {
			if (this.controller === wasController) {
				this.ui.progressBar.infinite();
			}
		}, () => { /* ignore */ });

		this.controller.ready.then(() => {
			delay.cancel();
			if (this.controller !== wasController) {
				return;
			}

			this.ui.progressBar.stop();
			this.ready = true;

			this.updateLayout();
		}).then(null, reason => this.close(TPromise.wrapError(reason)));

		return this.controller.result;
	}

	private createController(parameters: InputParameters) {
		switch (parameters.type) {
			case 'pickOne': return new PickOneController(this.ui, parameters);
			case 'pickMany': return new PickManyController(this.ui, parameters);
			case 'textInput': return new TextInputController(this.ui, parameters);
			default: ((p: never) => {
				throw new Error(`Unknown input type: ${(<any>p).type}`);
			})(parameters);
		}
	}

	private show2(controller: QuickInput) {
		this.create();
		this.quickOpenService.close();
		const oldController = this.controller2;
		this.controller2 = controller;
		if (oldController) {
			oldController.doHide();
		}

		this.ui.checkAll.checked = false;
		this.ui.inputBox.value = '';
		this.ui.inputBox.placeholder = '';
		this.ui.inputBox.password = false;
		this.ui.inputBox.showDecoration(Severity.Ignore);
		this.ui.count.setCount(0);
		this.ui.message.textContent = '';
		this.ui.progressBar.stop();
		this.ui.list.setElements([]);
		this.ui.list.matchOnDescription = false;
		this.ui.list.matchOnDetail = false;
		this.ui.ignoreFocusOut = false;

		this.inQuickOpen('quickInput', true);

		this.ui.container.style.display = '';
		this.updateLayout();
		this.ui.inputBox.setFocus();
	}

	private setVisibilities(visibilities: Visibilities) {
		this.ui.checkAll.style.display = visibilities.checkAll ? '' : 'none';
		this.filterContainer.style.display = visibilities.inputBox ? '' : 'none';
		this.countContainer.style.display = visibilities.count ? '' : 'none';
		this.okContainer.style.display = visibilities.ok ? '' : 'none';
		this.ui.message.style.display = visibilities.message ? '' : 'none';
		this.ui.list.display(visibilities.list);
		this.ui.container.classList[visibilities.checkAll ? 'add' : 'remove']('show-checkboxes');
		this.updateLayout(); // TODO
	}

	focus() {
		if (this.isDisplayed()) {
			this.ui.inputBox.setFocus();
		}
	}

	toggle() {
		if (this.isDisplayed() && ((this.controller2 instanceof QuickPick && this.controller2.canSelectMany) || this.controller instanceof PickManyController)) {
			this.ui.list.toggleCheckbox();
		}
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration) {
		if (this.isDisplayed() && this.ui.list.isDisplayed()) {
			this.ui.list.focus(next ? 'Next' : 'Previous');
			if (quickNavigate && this.controller instanceof PickOneController) {
				this.controller.configureQuickNavigate(quickNavigate);
			}
		}
	}

	accept() {
		if (this.controller) {
			return this.close(true);
		} else {
			this.onDidAcceptEmitter.fire();
			return TPromise.as(undefined);
		}
	}

	cancel() {
		if (this.controller) {
			return this.close();
		} else {
			this.hide2();
			return TPromise.as(undefined);
		}
	}

	layout(dimension: dom.Dimension): void {
		this.layoutDimensions = dimension;
		this.updateLayout();
	}

	private updateLayout() {
		if (this.layoutDimensions && this.ui) {
			const titlebarOffset = this.partService.getTitleBarOffset();
			this.ui.container.style.top = `${titlebarOffset}px`;

			const style = this.ui.container.style;
			const width = Math.min(this.layoutDimensions.width * 0.62 /* golden cut */, QuickInputService.MAX_WIDTH);
			style.width = width + 'px';
			style.marginLeft = '-' + (width / 2) + 'px';

			this.ui.inputBox.layout();
			this.ui.list.layout();
		}
	}

	protected updateStyles() {
		const theme = this.themeService.getTheme();
		if (this.ui) {
			this.ui.inputBox.style(theme);
		}
		if (this.ui) {
			const sideBarBackground = theme.getColor(SIDE_BAR_BACKGROUND);
			this.ui.container.style.backgroundColor = sideBarBackground ? sideBarBackground.toString() : undefined;
			const sideBarForeground = theme.getColor(SIDE_BAR_FOREGROUND);
			this.ui.container.style.color = sideBarForeground ? sideBarForeground.toString() : undefined;
			const contrastBorderColor = theme.getColor(contrastBorder);
			this.ui.container.style.border = contrastBorderColor ? `1px solid ${contrastBorderColor}` : undefined;
			const widgetShadowColor = theme.getColor(widgetShadow);
			this.ui.container.style.boxShadow = widgetShadowColor ? `0 5px 8px ${widgetShadowColor}` : undefined;
		}
	}

	private isDisplayed() {
		return this.ui && this.ui.container.style.display !== 'none';
	}
}

export const QuickPickManyToggle: ICommandAndKeybindingRule = {
	id: 'workbench.action.quickPickManyToggle',
	weight: KeybindingsRegistry.WEIGHT.workbenchContrib(),
	when: inQuickOpenContext,
	primary: undefined,
	handler: accessor => {
		const quickInputService = accessor.get(IQuickInputService);
		quickInputService.toggle();
	}
};

class QuickInput implements IQuickInput {

	protected visible = false;
	private _enabled = true;
	private _busy = false;
	private _ignoreFocusOut = false;
	private onDidHideEmitter = new Emitter<void>();

	protected visibleDisposables: IDisposable[] = [];
	protected disposables: IDisposable[] = [];

	private busyDelay: TPromise<void>;

	constructor(protected ui: QuickInputUI) {
		this.disposables.push(this.onDidHideEmitter);
	}

	get enabled() {
		return this._enabled;
	}

	set enabled(enabled: boolean) {
		this._enabled = enabled;
		this.update(); // TODO
	}

	get busy() {
		return this._busy;
	}

	set busy(busy: boolean) {
		this._busy = busy;
		this.update();
	}

	get ignoreFocusOut() {
		return this._ignoreFocusOut;
	}

	set ignoreFocusOut(ignoreFocusOut: boolean) {
		this._ignoreFocusOut = ignoreFocusOut;
		this.update();
	}

	show(): void {
		if (this.visible) {
			return;
		}
		this.ui.show(this);
		this.visible = true;
		this.update();
	}

	hide(): void {
		if (!this.visible) {
			return;
		}
		this.ui.hide();
	}

	doHide(): void {
		this.visible = false;
		this.visibleDisposables = dispose(this.visibleDisposables);
		this.onDidHideEmitter.fire();
	}

	onDidHide = this.onDidHideEmitter.event;

	protected update() {
		if (!this.visible) {
			return;
		}
		if (this.busy && !this.busyDelay) {
			this.busyDelay = TPromise.timeout(800);
			this.busyDelay.then(() => {
				this.ui.progressBar.infinite();
			}, () => { /* ignore */ });
		}
		if (!this.busy && this.busyDelay) {
			this.ui.progressBar.stop();
			this.busyDelay.cancel();
			this.busyDelay = null;
		}
	}

	public dispose(): void {
		this.hide();
		this.disposables = dispose(this.disposables);
	}
}

class QuickPick extends QuickInput implements IQuickPick {

	private _value = '';
	private _placeholder = '';
	private onDidChangeValueEmitter = new Emitter<string>();
	private onDidAcceptEmitter = new Emitter<string>();
	private _commands: IQuickInputButton[] = [];
	private onDidTriggerCommandEmitter = new Emitter<IQuickInputButton>();
	private _items: IQuickPickItem[] = [];
	private itemsUpdated = false;
	private _canSelectMany = false;
	private _matchOnDescription = true;
	private _matchOnDetail = true;
	private _activeItems: IQuickPickItem[] = [];
	private onDidChangeActiveEmitter = new Emitter<IQuickPickItem[]>();
	private _selectedItems: IQuickPickItem[] = [];
	private onDidChangeSelectionEmitter = new Emitter<IQuickPickItem[]>();

	constructor(ui: QuickInputUI) {
		super(ui);
		this.disposables.push(
			this.onDidChangeValueEmitter,
			this.onDidAcceptEmitter,
			this.onDidTriggerCommandEmitter,
			this.onDidChangeActiveEmitter,
			this.onDidChangeSelectionEmitter,
		);
	}

	get value() {
		return this._value;
	}

	set value(value: string) {
		this._value = value || '';
		this.update();
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string) {
		this._placeholder = placeholder || '';
		this.update();
	}

	onDidValueChange = this.onDidChangeValueEmitter.event;

	onDidAccept = this.onDidAcceptEmitter.event;

	get buttons() {
		return this._commands;
	}

	set buttons(commands: IQuickInputButton[]) {
		this._commands = commands;
		this.update(); // TODO
	}

	onDidTriggerCommand = this.onDidTriggerCommandEmitter.event;

	get items() {
		return this._items;
	}

	set items(items: IQuickPickItem[]) {
		this._items = items;
		this.itemsUpdated = true;
		this.update();
	}

	get canSelectMany() {
		return this._canSelectMany;
	}

	set canSelectMany(canSelectMany: boolean) {
		this._canSelectMany = canSelectMany;
		this.update();
	}

	get matchOnDescription() {
		return this._matchOnDescription;
	}

	set matchOnDescription(matchOnDescription: boolean) {
		this._matchOnDescription = matchOnDescription;
		this.update();
	}

	get matchOnDetail() {
		return this._matchOnDetail;
	}

	set matchOnDetail(matchOnDetail: boolean) {
		this._matchOnDetail = matchOnDetail;
		this.update();
	}

	get activeItems() {
		return this._activeItems;
	}

	onDidChangeActive = this.onDidChangeActiveEmitter.event;

	get selectedItems() {
		return this._selectedItems;
	}

	onDidChangeSelection = this.onDidChangeSelectionEmitter.event;

	show() {
		if (!this.visible) {
			// TODO: this.onDidTriggerCommandEmitter,
			this.visibleDisposables.push(
				this.ui.inputBox.onDidChange(value => {
					this._value = value;
					this.ui.list.filter(this.ui.inputBox.value);
					if (!this.canSelectMany) {
						this.ui.list.focus('First');
					}
					this.onDidChangeValueEmitter.fire(value);
				}),
				this.ui.inputBox.onKeyDown(event => {
					switch (event.keyCode) {
						case KeyCode.DownArrow:
							this.ui.list.focus('Next');
							if (this.canSelectMany) {
								this.ui.list.domFocus();
							}
							break;
						case KeyCode.UpArrow:
							this.ui.list.focus('Previous');
							if (this.canSelectMany) {
								this.ui.list.domFocus();
							}
							break;
					}
				}),
				this.ui.onDidAccept(() => this.onDidAcceptEmitter.fire()),
				this.ui.list.onDidChangeFocus(focusedItems => {
					// Drop initial event.
					if (!focusedItems.length && !this._activeItems.length) {
						return;
					}
					this._activeItems = focusedItems;
					this.onDidChangeActiveEmitter.fire(focusedItems);
				}),
				this.ui.list.onDidChangeSelection(selectedItems => {
					if (this.canSelectMany) {
						return;
					}
					// Drop initial event.
					if (!selectedItems.length && !this._selectedItems.length) {
						return;
					}
					this._selectedItems = selectedItems;
					this.onDidChangeSelectionEmitter.fire(selectedItems);
				}),
				this.ui.list.onChangedCheckedElements(checkedItems => {
					if (!this.canSelectMany) {
						return;
					}
					this._selectedItems = checkedItems;
					this.onDidChangeSelectionEmitter.fire(checkedItems);
				}),
			);
		}
		super.show();
	}

	protected update() {
		super.update();
		if (!this.visible) {
			return;
		}
		if (this.ui.inputBox.value !== this.value) {
			this.ui.inputBox.value = this.value;
		}
		if (this.ui.inputBox.placeholder !== this.placeholder) {
			this.ui.inputBox.placeholder = this.placeholder;
		}
		if (this.itemsUpdated) {
			this.ui.list.setElements(this.items);
			this.ui.list.filter(this.ui.inputBox.value);
			this.ui.checkAll.checked = this.ui.list.getAllVisibleChecked();
			this.ui.count.setCount(this.ui.list.getCheckedCount());
			if (!this.canSelectMany) {
				this.ui.list.focus('First');
			}
			this.itemsUpdated = false;
		}
		if (this.ui.container.classList.contains('show-checkboxes') !== this.canSelectMany) {
			if (this.canSelectMany) {
				this.ui.list.clearFocus();
			} else {
				this.ui.list.focus('First');
			}
		}
		this.ui.ignoreFocusOut = this.ignoreFocusOut;
		this.ui.list.matchOnDescription = this.matchOnDescription;
		this.ui.list.matchOnDetail = this.matchOnDetail;
		this.ui.setVisibilities(this.canSelectMany ? { checkAll: true, inputBox: true, count: true, ok: true, list: true } : { inputBox: true, list: true });
	}
}

class InputBox extends QuickInput implements IInputBox {

	private _value = '';
	private _valueSelection: Readonly<[number, number]>;
	private valueSelectionUpdated = true;
	private _placeholder = '';
	private _password = false;
	private _prompt = '';
	private _validationMessage = '';
	private onDidValueChangeEmitter = new Emitter<string>();
	private onDidAcceptEmitter = new Emitter<string>();
	private _commands: IQuickInputButton[] = [];
	private onDidTriggerCommandEmitter = new Emitter<IQuickInputButton>();

	constructor(ui: QuickInputUI) {
		super(ui);
		this.disposables.push(
			this.onDidValueChangeEmitter,
			this.onDidAcceptEmitter,
			this.onDidTriggerCommandEmitter,
		);
	}

	get value() {
		return this._value;
	}

	set value(value: string) {
		this._value = value || '';
		this.update();
	}

	set valueSelection(valueSelection: Readonly<[number, number]>) {
		this._valueSelection = valueSelection;
		this.valueSelectionUpdated = true;
		this.update();
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string) {
		this._placeholder = placeholder || '';
		this.update();
	}

	get password() {
		return this._password;
	}

	set password(password: boolean) {
		this._password = password || false;
		this.update();
	}

	get prompt() {
		return this._prompt;
	}

	set prompt(prompt: string) {
		this._prompt = prompt || '';
		this.update();
	}

	get validationMessage() {
		return this._validationMessage;
	}

	set validationMessage(validationMessage: string) {
		this._validationMessage = validationMessage || '';
		this.update();
	}

	onDidChangeValue = this.onDidValueChangeEmitter.event;

	onDidAccept = this.onDidAcceptEmitter.event;

	get buttons() {
		return this._commands;
	}

	set buttons(commands: IQuickInputButton[]) {
		this._commands = commands;
		this.update(); // TODO
	}

	onDidTriggerButton = this.onDidTriggerCommandEmitter.event;

	show() {
		if (!this.visible) {
			// TODO: this.onDidTriggerCommandEmitter,
			this.visibleDisposables.push(
				this.ui.inputBox.onDidChange(value => {
					this._value = value;
					this.onDidValueChangeEmitter.fire(value);
				}),
				this.ui.onDidAccept(() => this.onDidAcceptEmitter.fire()),
			);
		}
		super.show();
	}

	protected update() {
		super.update();
		if (!this.visible) {
			return;
		}
		if (this.ui.inputBox.value !== this.value) {
			this.ui.inputBox.value = this.value;
		}
		if (this.valueSelectionUpdated) {
			this.valueSelectionUpdated = false;
			this.ui.inputBox.select(this._valueSelection && { start: this._valueSelection[0], end: this._valueSelection[1] });
		}
		if (this.ui.inputBox.placeholder !== this.placeholder) {
			this.ui.inputBox.placeholder = this.placeholder;
		}
		if (this.ui.inputBox.password !== this.password) {
			this.ui.inputBox.password = this.password;
		}
		if (this.ui.inputBox.password !== this.password) {
			this.ui.inputBox.password = this.password;
		}
		if (!this.validationMessage && this.ui.message.textContent !== this.prompt) {
			this.ui.message.textContent = this.prompt;
			this.ui.inputBox.showDecoration(Severity.Ignore);
		}
		if (this.validationMessage && this.ui.message.textContent !== this.validationMessage) {
			this.ui.message.textContent = this.validationMessage;
			this.ui.inputBox.showDecoration(Severity.Error);
		}
		this.ui.setVisibilities({ inputBox: true, message: true });
	}
}