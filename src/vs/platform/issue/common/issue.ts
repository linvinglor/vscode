/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';

export const IIssueService = createDecorator<IIssueService>('issueService');

export interface WindowStyles {
	backgroundColor: string;
	color: string;
}
export interface WindowData {
	styles: WindowStyles;
	zoomLevel: number;
}

export enum IssueType {
	Bug,
	PerformanceIssue,
	FeatureRequest,
	SettingsSearchIssue
}

export interface IssueReporterStyles extends WindowStyles {
	textLinkColor: string;
	inputBackground: string;
	inputForeground: string;
	inputBorder: string;
	inputErrorBorder: string;
	inputActiveBorder: string;
	buttonBackground: string;
	buttonForeground: string;
	buttonHoverBackground: string;
	sliderBackgroundColor: string;
	sliderHoverColor: string;
	sliderActiveColor: string;
}

export interface IssueReporterData extends WindowData {
	styles: IssueReporterStyles;
	enabledExtensions: ILocalExtension[];
	issueType?: IssueType;
}

export interface ISettingSearchResult {
	extensionId: string;
	key: string;
	score: number;
}

export interface ISettingsSearchIssueReporterData extends IssueReporterData {
	issueType: IssueType.SettingsSearchIssue;
	actualSearchResults: ISettingSearchResult[];
	query: string;
	filterResultCount: number;
}

export interface IssueReporterFeatures {
}

export interface ProcessExplorerStyles extends WindowStyles {
	hoverBackground: string;
	hoverForeground: string;
	highlightForeground: string;
}

export interface ProcessExplorerData extends WindowData {
	styles: ProcessExplorerStyles;
}

export interface IIssueService {
	_serviceBrand: any;
	openReporter(data: IssueReporterData): TPromise<void>;
	openProcessExplorer(data: ProcessExplorerData): TPromise<void>;
	// TODO: getSystemInfo would make more sense in a diagnostics-related service
	getSystemInfo(): TPromise<SystemInfo>;
}

// This interface is copied from Electron to prevent a layer issue
export interface GPUFeatureStatus {

	// Docs: http://electron.atom.io/docs/api/structures/gpu-feature-status

	/**
	 * Canvas
	 */
	'2d_canvas': string;
	/**
	 * Flash
	 */
	flash_3d: string;
	/**
	 * Flash Stage3D
	 */
	flash_stage3d: string;
	/**
	 * Flash Stage3D Baseline profile
	 */
	flash_stage3d_baseline: string;
	/**
	 * Compositing
	 */
	gpu_compositing: string;
	/**
	 * Multiple Raster Threads
	 */
	multiple_raster_threads: string;
	/**
	 * Native GpuMemoryBuffers
	 */
	native_gpu_memory_buffers: string;
	/**
	 * Rasterization
	 */
	rasterization: string;
	/**
	 * Video Decode
	 */
	video_decode: string;
	/**
	 * Video Encode
	 */
	video_encode: string;
	/**
	 * VPx Video Decode
	 */
	vpx_decode: string;
	/**
	 * WebGL
	 */
	webgl: string;
	/**
	 * WebGL2
	 */
	webgl2: string;
}

export interface SystemInfo {
	CPUs?: string;
	'Memory (System)': string;
	'Load (avg)'?: string;
	VM: string;
	'Screen Reader': string;
	'Process Argv': string;
	'GPU Status': GPUFeatureStatus;
}