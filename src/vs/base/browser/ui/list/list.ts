/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GestureEvent } from 'vs/base/browser/touch';
import { DragMouseEvent } from 'vs/base/browser/mouseEvent';

export interface IListVirtualDelegate<T> {
	getHeight(element: T): number;
	getTemplateId(element: T): string;
	hasDynamicHeight?(element: T): boolean;
}

export interface IListRenderer<T, TTemplateData> {
	templateId: string;
	renderTemplate(container: HTMLElement): TTemplateData;
	renderElement(element: T, index: number, templateData: TTemplateData): void;
	disposeElement(element: T, index: number, templateData: TTemplateData): void;
	disposeTemplate(templateData: TTemplateData): void;
}

export interface IListEvent<T> {
	elements: T[];
	indexes: number[];
	browserEvent?: UIEvent;
}

export interface IListMouseEvent<T> {
	browserEvent: MouseEvent;
	element: T | undefined;
	index: number;
}

export interface IListTouchEvent<T> {
	browserEvent: TouchEvent;
	element: T | undefined;
	index: number;
}

export interface IListGestureEvent<T> {
	browserEvent: GestureEvent;
	element: T | undefined;
	index: number;
}

export interface IListContextMenuEvent<T> {
	browserEvent: UIEvent;
	element: T | undefined;
	index: number;
	anchor: HTMLElement | { x: number; y: number; } | undefined;
}

export const enum DragOverEffect {
	Copy,
	Move
}

// export const enum DragOverBubble {
// 	Down,
// 	Up
// }

export interface IDragOverReaction {
	accept: boolean;
	effect?: DragOverEffect;
	// bubble?: DragOverBubble;
	// autoExpand?: boolean;
}

export const DragOverReactions = {
	reject(): IDragOverReaction { return { accept: false }; },
	accept(): IDragOverReaction { return { accept: true }; },
	// acceptBubbleUp(): IDragOverReaction { return { accept: true, bubble: DragOverBubble.Up }; },
	// acceptBubbleDown(autoExpand = false): IDragOverReaction { return { accept: true, bubble: DragOverBubble.Down, autoExpand }; },
	// acceptCopyBubbleUp(): IDragOverReaction { return { accept: true, bubble: DragOverBubble.Up, effect: DragOverEffect.Copy }; },
	// acceptCopyBubbleDown(autoExpand = false): IDragOverReaction { return { accept: true, bubble: DragOverBubble.Down, effect: DragOverEffect.Copy, autoExpand }; }
};

export interface IDragAndDropData {
	update(event: DragMouseEvent): void;
	getData(): any;
}

export interface IDragAndDrop<T> {
	getDragURI(element: T): string;
	getDragLabel?(elements: T[]): string;
	onDragStart(data: IDragAndDropData, originalEvent: DragMouseEvent): void;
	onDragOver(data: IDragAndDropData, targetElement: T, originalEvent: DragMouseEvent): IDragOverReaction;
	drop(data: IDragAndDropData, targetElement: T, originalEvent: DragMouseEvent): void;
}