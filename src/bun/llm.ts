import type { LLMConfig } from "../shared/types";

type Message = { role: string; content: string };

/** 测试连接等轻量请求的硬超时：快速失败，避免配置错误时长时间挂起 */
const REQUEST_TIMEOUT_MS = 60_000;
/** 生成类请求（预检 / 生图）的超时：长输出模型可达数分钟 */
const GENERATION_TIMEOUT_MS = 300_000;

/**
 * fetch with a hard timeout so a wrong base_url / dead network fails fast
 * instead of hanging until the RPC layer's cap.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		// AbortSignal.timeout 抛出的 DOMException 在 Bun 下不是 Error 实例，必须按 name 判断
		const name = (err as { name?: string })?.name;
		if (name === "TimeoutError" || name === "AbortError") {
			throw new Error(`请求超时（${timeoutMs / 1000} 秒）：模型响应过慢或网络不通，请稍后重试`);
		}
		throw err;
	}
}

/**
 * Call an OpenAI-compatible chat completion endpoint.
 * Works with DeepSeek, MiMo, Ollama (/v1), and any OpenAI-compatible provider.
 */
export async function chatCompletion(config: LLMConfig, messages: Message[], timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
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
	}, timeoutMs);

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
 * Run a text generation precheck using the prompt content.
 */
export async function generateText(config: LLMConfig, promptContent: string): Promise<string> {
	return chatCompletion(config, [{ role: "user", content: promptContent }], GENERATION_TIMEOUT_MS);
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
	return chatCompletion(config, [systemMsg, userMsg], GENERATION_TIMEOUT_MS);
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
	}, GENERATION_TIMEOUT_MS);

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
