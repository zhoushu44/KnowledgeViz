/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 内置大模型接口地址（OpenAI 兼容），如 https://your-gateway.example.com/v1 */
  readonly VITE_KSB_LLM_BASE_URL?: string;
  /** 内置大模型 API Key */
  readonly VITE_KSB_LLM_API_KEY?: string;
  /** 默认模型名，缺省 deepseek-v4-flash */
  readonly VITE_KSB_LLM_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
