import { describe, test, expect } from "bun:test";
import { extractVariables, fillVariables } from "../src/shared/types";

describe("extractVariables", () => {
	test("extracts simple variables", () => {
		expect(extractVariables("你好{{名字}}，我是{{职业}}")).toEqual(["名字", "职业"]);
	});

	test("deduplicates while preserving first-seen order", () => {
		expect(extractVariables("{{b}} {{a}} {{b}} {{a}}")).toEqual(["b", "a"]);
	});

	test("supports english, underscore and hyphen names", () => {
		expect(extractVariables("{{language}} {{user_name}} {{model-4}}")).toEqual(["language", "user_name", "model-4"]);
	});

	test("rejects pure-number names (kept as literal text)", () => {
		expect(extractVariables("年份{{2024}}")).toEqual([]);
	});

	test("rejects names with spaces or special characters", () => {
		expect(extractVariables("{{hello world}} {{a+b}} {{x!}}")).toEqual([]);
	});

	test("handles triple braces by matching the inner pair", () => {
		// {{{name}}} -> the regex matches the inner {{name}}, outer braces stay literal
		expect(extractVariables("{{{name}}}")).toEqual(["name"]);
		expect(fillVariables("{{{name}}}", { name: "X" })).toBe("{X}");
	});

	test("empty content yields no variables", () => {
		expect(extractVariables("")).toEqual([]);
		expect(extractVariables("no placeholders here")).toEqual([]);
	});

	test("trims whitespace inside placeholders", () => {
		expect(extractVariables("{{  name  }}")).toEqual(["name"]);
	});
});

describe("fillVariables", () => {
	test("replaces filled variables", () => {
		expect(fillVariables("你好{{名字}}，我是{{职业}}", { 名字: "小明", 职业: "工程师" })).toBe("你好小明，我是工程师");
	});

	test("keeps unfilled variables as-is", () => {
		expect(fillVariables("{{a}}-{{b}}", { a: "1" })).toBe("1-{{b}}");
	});

	test("empty-string value counts as filled", () => {
		expect(fillVariables("[{{a}}]", { a: "" })).toBe("[]");
	});

	test("replaces every occurrence", () => {
		expect(fillVariables("{{x}} and {{x}}", { x: "ok" })).toBe("ok and ok");
	});

	test("prefix-collision: lang vs language", () => {
		const content = "{{language}} {{lang}}";
		expect(fillVariables(content, { lang: "zh", language: "中文" })).toBe("中文 zh");
	});

	test("content without variables is returned unchanged", () => {
		expect(fillVariables("plain text", { a: "1" })).toBe("plain text");
	});
});
