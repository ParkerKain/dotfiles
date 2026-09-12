import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export interface FieldsetState {
	startedAt?: number;
	endedAt?: number;
	timer?: ReturnType<typeof setInterval>;
}

export interface FieldsetContext {
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	invalidate: () => void;
}

const BORDER_COLOR = "borderAccent";
const PREVIEW_LINES = 5;

export function fieldsetState(state: unknown): FieldsetState {
	return (state ?? {}) as FieldsetState;
}

export function trackFieldsetTiming(
	state: FieldsetState,
	context: FieldsetContext,
	complete = false,
): void {
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}

	if (!complete && state.startedAt !== undefined && state.timer === undefined) {
		state.timer = setInterval(() => context.invalidate(), 1_000);
	}

	if (complete) {
		state.endedAt ??= Date.now();
		if (state.timer !== undefined) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
	}
}

function duration(state: FieldsetState): string {
	if (state.startedAt === undefined) return "";
	const milliseconds = Math.max(0, (state.endedAt ?? Date.now()) - state.startedAt);
	if (milliseconds < 1_000) return `${milliseconds}ms`;
	return `${(milliseconds / 1_000).toFixed(1)}s`;
}

export function fieldsetStatus(
	theme: Theme,
	state: FieldsetState,
	context: FieldsetContext,
): string {
	const elapsed = duration(state);
	if (!context.executionStarted) return theme.fg("muted", "○ queued");
	if (context.isPartial && !context.isError) {
		return theme.fg("warning", `◌ running${elapsed ? ` · ${elapsed}` : ""}`);
	}
	if (context.isError) return theme.fg("error", `✕ failed${elapsed ? ` · ${elapsed}` : ""}`);
	return theme.fg("success", `✓ success${elapsed ? ` · ${elapsed}` : ""}`);
}

function border(text: string, theme: Theme): string {
	return theme.fg(BORDER_COLOR, text);
}

function topLine(width: number, label: string, theme: Theme): string {
	const left = "╭─ ";
	const right = " ─╮";
	const available = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
	const trimmed = truncateToWidth(label, available, "…");
	const fill = Math.max(0, available - visibleWidth(trimmed));
	return `${border(left, theme)}${trimmed}${border(`${"─".repeat(fill)}${right}`, theme)}`;
}

function contentLine(width: number, content: string, theme: Theme): string {
	const left = "│ ";
	const right = " │";
	const innerWidth = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
	const trimmed = truncateToWidth(content, innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
	return `${border(left, theme)}${trimmed}${padding}${border(right, theme)}`;
}

function bottomLine(width: number, theme: Theme): string {
	if (width <= 1) return border("╰", theme);
	return border(`╰${"─".repeat(Math.max(0, width - 2))}╯`, theme);
}

export class FieldsetHeader implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly getTitle: () => string,
		private readonly getContext: () => FieldsetContext,
		private readonly state: FieldsetState,
	) {}

	render(width: number): string[] {
		const context = this.getContext();
		const title = this.getTitle();
		const status = fieldsetStatus(this.theme, this.state, context);
		return [topLine(width, `${status}  ${this.theme.fg("toolTitle", this.theme.bold(title))}`, this.theme)];
	}

	invalidate(): void {}
}

export class FieldsetBody implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly getLines: (width: number) => string[],
	) {}

	render(width: number): string[] {
		const lines = this.getLines(width).flatMap((line) => String(line).split("\n"));
		return [...lines.map((line) => contentLine(width, line, this.theme)), bottomLine(width, this.theme)];
	}

	invalidate(): void {}
}

export function previewLines(
	text: string,
	expanded: boolean,
	theme: Theme,
	keyHint?: string,
): string[] {
	const normalized = text.trim();
	if (!normalized) return [theme.fg("muted", "(no output)")];

	const lines = normalized.split("\n");
	if (expanded || lines.length <= PREVIEW_LINES) return lines;

	const skipped = lines.length - PREVIEW_LINES;
	const hint = keyHint ? ` ${keyHint}` : "";
	return [theme.fg("muted", `… ${skipped} earlier lines${hint}`), ...lines.slice(-PREVIEW_LINES)];
}
