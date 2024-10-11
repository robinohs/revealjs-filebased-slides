#! /usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { walkFiles } from "walk-it";
import path from "node:path";
import { JSDOM } from "jsdom";
import { watch } from "node:fs/promises";
import type { SlideFile } from "./types";

if (import.meta.main) {
	yargs(hideBin(process.argv))
		.command(
			"merge-slides [template] [slides-path] [output]",
			"Merges slides and template into an output presentation.",
			(yargs) => {
				return yargs
					.positional("template", {
						describe: "The revealjs template with which the slides are merged",
						default: "./template.html",
					})
					.positional("slides-path", {
						describe: "The path to the slide files",
						default: "./slides",
					})
					.positional("output", {
						describe: "The created presentation file",
						default: "./index.html",
					})
					.check(async (argv) => {
						const template_file = Bun.file(argv.template);
						if (!(await template_file.exists())) {
							return `Error: Template file at '${argv.template}' does not exists.`;
						}
						return true;
					});
			},
			async (argv) => {
				await merge_files(argv.template, argv.slidesPath, argv.output);
			},
		)
		.command(
			"watch [template] [slides-path] [output]",
			"Merges slides and template into an output presentation in watch mode.",
			(yargs) => {
				return yargs
					.positional("template", {
						describe: "The revealjs template with which the slides are merged",
						default: "./template.html",
					})
					.positional("slides-path", {
						describe: "The path to the slide files",
						default: "./slides",
					})
					.positional("output", {
						describe: "The created presentation file",
						default: "./index.html",
					})
					.check(async (argv) => {
						const template_file = Bun.file(argv.template);
						if (!(await template_file.exists())) {
							return `Error: Template file at '${argv.template}' does not exists.`;
						}
						return true;
					});
			},
			async (argv) => {
				await watch_files(argv.template, argv.slidesPath, argv.output);
			},
		)
		.strictCommands()
		.demandCommand(1)
		.parse();
}

async function watch_files(
	template: string,
	slidesPath: string,
	output: string,
) {
	const watcher = watch(slidesPath, {
		recursive: true,
	});
	for await (const event of watcher) {
		console.log(`Detected ${event.eventType} in ${event.filename}`);
		await merge_files(template, slidesPath, output);
	}
}

async function merge_files(
	template: string,
	slidesPath: string,
	output: string,
) {
	const absolute_slides_path = path.resolve(slidesPath);
	const files: SlideFile[] = [];
	for await (const { file, path: file_path } of walkFiles(slidesPath, {
		maxLevel: 1,
		recursive: true,
		filterFile: ({ name }) => name.endsWith(".html"),
	})) {
		const parent_path = file.parentPath
			.replace(absolute_slides_path, "")
			.replace("/", "");
		files.push({
			name: file.name,
			parent: parent_path === "" ? null : parent_path,
			path: file_path,
		});
	}
	sort_files(files);
	console.log("Slides will be added in the following order and hierarchy:");
	print_files(files);
	const dom = new JSDOM(await Bun.file(template).text());
	const slides_container = dom.window.document.getElementById("slides");
	if (slides_container === null) {
		throw new Error(
			"Could not find slides container html element with id 'slides'!",
		);
	}
	slides_container.innerHTML = "";
	let current_parent: string | null = null;
	let current_element: HTMLElement | null = null;
	for (const slide of files) {
		// check if is new horizontal slide
		if (
			current_parent === null ||
			current_element == null ||
			slide.parent !== current_parent
		) {
			current_parent = slide.parent;
			current_element = dom.window.document.createElement("section");
			slides_container.appendChild(current_element);
		}
		const { document } = new JSDOM(await Bun.file(slide.path).text()).window;
		for (const child of document.body.childNodes) {
			current_element.appendChild(child);
		}
	}
	const output_file = Bun.file(output);
	await Bun.write(output_file, dom.serialize());
}

function sort_files(files: SlideFile[]) {
	files.sort(
		(
			{ name: a_name, parent: a_parent },
			{ name: b_name, parent: b_parent },
		) => {
			// compare parents
			//// if parents are the same -> compare names
			// if one parent is null, compare the non-null parent with the name of the other
			if (a_parent === null || b_parent === null) {
				if (a_parent === null && b_parent !== null) {
					return a_name.localeCompare(b_parent);
				}
				if (a_parent !== null && b_parent === null) {
					return a_parent.localeCompare(b_name);
				}
				return a_name.localeCompare(b_name);
			}
			if (a_parent === b_parent) {
				return a_name.localeCompare(b_name);
			}
			return a_parent.localeCompare(b_parent);
		},
	);
}

function print_files(files: SlideFile[]) {
	let current_parent: string | null = null;
	for (const file of files) {
		if (file.parent !== current_parent) {
			if (file.parent !== null) {
				console.log(file.parent);
			}
			current_parent = file.parent;
		}
		if (file.parent !== null) {
			console.log("⊢", file.name);
		} else {
			console.log(file.name);
		}
	}
}
