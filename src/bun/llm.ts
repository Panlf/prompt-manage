import type { LLMConfig } from "../shared/types";

type Message = { role: string; content: string };

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * fetch with a hard timeout so a wrong base_url / dead network fails fast
 * instead of hanging until the RPC layer's 120s cap.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	} catch (err) {
		if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
			throw new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）：请检查 Base URL 是否可达以及网络连通性`);
		}
		throw err;
	}
}

/**
 * Call an OpenAI-compatible chat completion endpoint.
 * Works with DeepSeek, MiMo, Ollama (/v1), and any OpenAI-compatible provider.
 */
export async function chatCompletion(config: LLMConfig, messages: Message[]): Promise<string> {
	const url = config.base_url.replace(/\/$/, "") + "/chat/completions";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (config.api_key) {
		headers["Authorization"] = `Bearer ${config.api_key}`;
	}

	const response = await fetchWithTimeout(url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: config.model,
			messages,
			stream: false,
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(`API ${response.status}: ${errText || response.statusText}`);
	}

	const data = (await response.json()) as any;
	const content = data?.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error("API returned empty response");
	}
	return content;
}

/**
 * Generate a prompt using the LLM based on a scenario description.
 */
export async function generatePromptAI(config: LLMConfig, scenarioName: string, description: string): Promise<string> {
	const systemMsg: Message = {
		role: "system",
		content: "你是一个专业的提示词工程师。请根据用户的使用场景描述，生成一个高质量的提示词。只返回提示词内容本身，不要加任何额外说明或解释。",
	};
	const userMsg: Message = {
		role: "user",
		content: `使用场景名称：${scenarioName}\n场景描述：${description}\n\n请生成一个适用于该场景的提示词。`,
	};
	return chatCompletion(config, [systemMsg, userMsg]);
}

/**
 * Run a text generation precheck using the prompt content.
 */
export async function generateText(config: LLMConfig, promptContent: string): Promise<string> {
	return chatCompletion(config, [{ role: "user", content: promptContent }]);
}

/**
 * Run a text optimization precheck using the prompt and input text.
 */
export async function optimizeText(config: LLMConfig, promptContent: string, inputText: string): Promise<string> {
	const systemMsg: Message = {
		role: "system",
		content: promptContent,
	};
	const userMsg: Message = {
		role: "user",
		content: inputText,
	};
	return chatCompletion(config, [systemMsg, userMsg]);
}

/**
 * Generate an image using an OpenAI-compatible image generation endpoint.
 * Returns base64 image data or a URL.
 */
export async function generateImage(config: LLMConfig, promptContent: string): Promise<string> {
	const url = config.base_url.replace(/\/$/, "") + "/images/generations";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (config.api_key) {
		headers["Authorization"] = `Bearer ${config.api_key}`;
	}

	const response = await fetchWithTimeout(url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: config.model,
			prompt: promptContent,
			n: 1,
			size: "1024x1024",
			response_format: "b64_json",
		}),
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(`API ${response.status}: ${errText || response.statusText}`);
	}

	const data = (await response.json()) as any;
	const item = data?.data?.[0];
	if (item?.b64_json) {
		return `data:image/png;base64,${item.b64_json}`;
	}
	if (item?.url) {
		return item.url;
	}
	throw new Error("Image generation returned no result");
}

/**
 * Test connectivity to an LLM config by sending a simple request.
 */
export async function testConnection(config: LLMConfig): Promise<string> {
	const reply = await chatCompletion(config, [{ role: "user", content: '你好，请回复"连接成功"四个字。' }]);
	return reply;
}
