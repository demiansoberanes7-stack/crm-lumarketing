// Every model call in Postiz resolves its endpoint here, so a self-hoster can
// point the whole app at any OpenAI-compatible gateway (OpenRouter by default)
// by setting OPENROUTER_API_TOKEN. Without that token nothing changes: each
// call site keeps the endpoint and the model it has always used, so installs
// already talking to OpenAI are untouched.

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type AiEndpoint = {
  // true when OpenRouter is the one answering, which also switches model ids
  // and the image route over to its conventions
  gateway: boolean;
  apiKey: string;
  baseURL?: string;
};

// Read on every call: a test that rewrites the environment, or a container
// restarted with new values, must never be answered from a cached key.
export const aiEndpoint = (): AiEndpoint => {
  const token = process.env.OPENROUTER_API_TOKEN;

  if (token) {
    return {
      gateway: true,
      apiKey: token,
      baseURL: (process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL).replace(
        /\/+$/,
        ''
      ),
    };
  }

  return {
    gateway: false,
    apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  };
};

export const isAiGateway = () => aiEndpoint().gateway;

export const hasAiCredentials = () =>
  isAiGateway() || !!process.env.OPENAI_API_KEY;

// The model a call site asked for, unless the gateway override wins: gateway
// ids are namespaced (openai/gpt-4.1), so they cannot be mixed with the plain
// OpenAI ids every call site used to hardcode.
export const chatModel = (fallback: string) =>
  aiEndpoint().gateway
    ? process.env.OPENROUTER_MODEL || 'openai/gpt-4.1'
    : fallback;

// Pictures are the one thing the chat override cannot cover: an image id the
// gateway does not know fails the whole generation, so the gateway has to be
// told which model to use. undefined means "this install cannot generate
// pictures" and the caller reports that instead of sending a request that is
// bound to fail.
export const imageModel = (fallback: string): string | undefined =>
  aiEndpoint().gateway ? process.env.OPENROUTER_IMAGE_MODEL : fallback;
