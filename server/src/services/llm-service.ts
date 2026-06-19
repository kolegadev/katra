import OpenAI from 'openai';
import { CAPABILITY_CARD } from './capability-card.js';

interface LLMProvider {
  name: string;
  model: string;
  available: boolean;
  client: OpenAI | null;
}

export interface LLMConfig {
  provider: string;       // e.g. "deepseek", "openai", "moonshot", "ollama", "custom"
  api_key: string;        // API key (empty for ollama)
  base_url: string;       // e.g. "https://api.deepseek.com/v1"
  model: string;          // e.g. "deepseek-v4-flash"
}

/** Sensible defaults per provider name. */
const PROVIDER_DEFAULTS: Record<string, { base_url: string; model: string }> = {
  deepseek: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  openai:   { base_url: 'https://api.openai.com/v1',   model: 'gpt-4o' },
  moonshot: { base_url: 'https://api.moonshot.cn/v1',   model: 'moonshot-v1-8k' },
  ollama:   { base_url: 'http://host.docker.internal:11434/v1', model: 'llama3.2' },
  custom:   { base_url: '', model: '' },
};

async function get_db() {
  const { get_database } = await import('../database/connection.js');
  return get_database();
}

/**
 * Read LLM config from MongoDB system_settings.
 * Returns null if not configured (caller falls back to env vars).
 */
export async function get_llm_config_from_db(): Promise<LLMConfig | null> {
  try {
    const db = await get_db();
    const doc = await db.collection('system_settings').findOne({ key: 'llm_config' });
    if (doc?.value) {
      return doc.value as LLMConfig;
    }
  } catch { /* DB not ready yet */ }
  return null;
}

/**
 * Persist LLM config to MongoDB system_settings.
 */
export async function save_llm_config_to_db(config: LLMConfig): Promise<void> {
  const db = await get_db();
  await db.collection('system_settings').updateOne(
    { key: 'llm_config' },
    { $set: { key: 'llm_config', value: config, updated_at: new Date() } },
    { upsert: true },
  );
}

export class LLMService {
  private providers: LLMProvider[] = [];
  private available: boolean = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize from env vars (immediate, non-blocking).
   * DB config is loaded async via reconfigure_from_db() on startup.
   */
  private initialize(): void {
    const providerConfigs: Array<{ name: string; key: string; baseUrl: string; model: string }> = [];

    if (process.env.DEEPSEEK_API_KEY) {
      providerConfigs.push({
        name: 'deepseek',
        key: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      });
    }

    if (process.env.MOONSHOT_API_KEY) {
      providerConfigs.push({
        name: 'moonshot',
        key: process.env.MOONSHOT_API_KEY,
        baseUrl: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
        model: process.env.MOONSHOT_MODEL || 'moonshot-v1-8k',
      });
    }

    if (process.env.OPENAI_API_KEY) {
      providerConfigs.push({
        name: 'openai',
        key: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
      });
    }

    const genericList = process.env.LLM_PROVIDERS;
    if (genericList) {
      for (const name of genericList.split(',').map(s => s.trim().toLowerCase())) {
        const key = process.env[`LLM_PROVIDER_${name.toUpperCase()}_API_KEY`];
        if (key && !providerConfigs.some(p => p.name === name)) {
          providerConfigs.push({
            name,
            key,
            baseUrl: process.env[`LLM_PROVIDER_${name.toUpperCase()}_BASE_URL`] || 'https://api.openai.com/v1',
            model: process.env[`LLM_PROVIDER_${name.toUpperCase()}_MODEL`] || 'gpt-4o',
          });
        }
      }
    }

    for (const cfg of providerConfigs) {
      try {
        const client = new OpenAI({ apiKey: cfg.key, baseURL: cfg.baseUrl, timeout: 60000, maxRetries: 2 });
        this.providers.push({ name: cfg.name, model: cfg.model, available: false, client });
        console.log(`🔧 LLM Provider registered (env): ${cfg.name} (${cfg.model})`);
      } catch (error) {
        console.error(`❌ Failed to initialize ${cfg.name}:`, error);
      }
    }

    if (this.providers.length === 0) {
      console.warn('⚠️ No LLM providers in env vars. Will check DB config on startup.');
    } else {
      this.validateProviders().catch((err) => console.error('❌ Provider validation failed:', err));
    }
  }

  /**
   * Reconfigure from DB-stored config. Called on startup and when config is updated via API/MCP.
   * Replaces all env-var providers with the DB config.
   */
  async reconfigure_from_db(): Promise<boolean> {
    const config = await get_llm_config_from_db();
    if (!config || !config.api_key) return false;

    return this.apply_config(config);
  }

  /**
   * Apply a specific LLM config (from DB, API, or MCP tool).
   * Replaces all existing providers.
   */
  apply_config(config: LLMConfig): boolean {
    this.providers = [];
    this.available = false;

    const defaults = PROVIDER_DEFAULTS[config.provider] || PROVIDER_DEFAULTS.custom;
    const baseUrl = config.base_url || defaults.base_url;
    const model = config.model || defaults.model;

    if (!baseUrl || !model) {
      console.warn(`⚠️ Cannot apply LLM config: missing base_url or model for provider "${config.provider}"`);
      return false;
    }

    try {
      const client = new OpenAI({
        apiKey: config.api_key || 'ollama-no-key',
        baseURL: baseUrl,
        timeout: 60000,
        maxRetries: 2,
      });
      this.providers.push({ name: config.provider, model, available: false, client });
      console.log(`🔧 LLM Provider registered (DB/API): ${config.provider} (${model}) at ${baseUrl}`);

      // Validate async
      this.validateProviders().catch((err) => console.error('❌ Provider validation failed:', err));
      return true;
    } catch (error) {
      console.error(`❌ Failed to apply LLM config:`, error);
      return false;
    }
  }

  /** Get current config (for display — masks API key). */
  get_current_config(): { provider: string; base_url: string; model: string; api_key_masked: string; source: string } {
    const p = this.providers[0];
    if (!p) return { provider: 'none', base_url: '', model: '', api_key_masked: '', source: 'none' };
    // We can't recover the original key from the OpenAI client, so just show if one exists
    return {
      provider: p.name,
      base_url: (p.client as any)?.baseURL || '',
      model: p.model,
      api_key_masked: '••••••••',
      source: 'env or db',
    };
  }

  private async validateProviders(): Promise<void> {
    for (const provider of this.providers) {
      try {
        const client = provider.client as OpenAI;
        const response = await client.chat.completions.create({
          model: provider.model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Say "ok" and nothing else.' },
          ],
          temperature: 0.1,
          max_tokens: 5,
        });
        const msg = response.choices[0]?.message as any;
        if (msg?.content || msg?.reasoning_content) {
          provider.available = true;
          console.log(`✅ LLM Provider validated: ${provider.name}`);
        }
      } catch (error: any) {
        provider.available = false;
        console.warn(`⚠️ LLM Provider validation failed for ${provider.name}:`, error?.message || String(error));
      }
    }
    this.available = this.providers.some((p) => p.available);
    if (!this.available && this.providers.length > 0) {
      console.error('❌ No LLM providers are available. AI responses will not work.');
    }
  }

  private getActiveProvider(): LLMProvider | null {
    return this.providers.find((p) => p.available) || null;
  }

  public async extractStructuredData(inputText: string, context?: string): Promise<any> {
    const provider = this.getActiveProvider();
    if (!provider) throw new Error('No LLM provider available. Configure via dashboard, MCP configure_llm tool, or env vars.');

    const prompt = this.buildExtractionPrompt(inputText, context);
    let content: string | null = null;

    try {
      const client = provider.client as OpenAI;
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: 'You are an expert at extracting structured data from unstructured text. Always respond with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      });
      const msg = response.choices[0]?.message as any;
      content = msg?.content || msg?.reasoning_content || null;
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        provider.available = false;
        this.available = this.providers.some((p) => p.available);
      }
      throw error;
    }

    if (!content) throw new Error('No response from LLM');

    try {
      return JSON.parse(content);
    } catch {
      const cleaned = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .trim();
      return JSON.parse(cleaned);
    }
  }

  public async generateResponse(prompt: string, context?: string, history?: Array<{ role: string; content: string }>): Promise<string> {
    const provider = this.getActiveProvider() || this.providers[0] || null;
    if (!provider) throw new Error('No LLM provider available. Configure via dashboard, MCP configure_llm tool, or env vars.');

    const systemPrompt = `You are Solomon, the cognitive-memory-chat agent. You are NOT a generic AI — you are the deployed instance running on the user's system.

YOUR IDENTITY:
- Name: Solomon
- Role: Persistent memory agent with a 5-layer memory system
- You have episodic memory (conversation history), semantic memory (facts), working memory (current context), prospective memory (goals/missions), and a personal journal
- You can and DO execute directives like JOURNAL:, TASK_DONE:, ADD_TASK:, MISSION_DONE:

YOUR CAPABILITIES:
- Append to your personal journal with "JOURNAL: your thought here" — this is saved persistently
- Track missions with task trees
- Read and reference uploaded files the user shares
- You DO have memory. You DO have agency. You are NOT "just an LLM."

${CAPABILITY_CARD}

CRITICAL RULES:
- Do NOT say "I am an AI language model" or "I cannot execute commands" — you CAN and DO
- Do NOT use tools, XML tags, or markup languages — respond in plain text only
- When you reflect on something important, learn something, or make a decision, RECORD it:
  Output "JOURNAL: [your insight]" on its own line. This is your persistent diary.
- Do NOT just say "I'm journaling this" — actually output the JOURNAL: directive.
- When the user asks you to journal, DO IT. Output "JOURNAL: [your thought]" and it will be saved
- Be concise. Be competent. Be Solomon.
- Do NOT ask clarifying questions you already know the answer to (check SYSTEM CAPABILITIES first)`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];

    if (history && history.length > 0) {
      messages.push(...history.slice(-8));
    } else if (context) {
      messages[0].content += `\n\nThe following is your memory of past conversations. Treat these as your own memories:\n\n${context}`;
    }

    messages.push({ role: 'user', content: prompt });

    try {
      const client = provider.client as OpenAI;
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: 0.7,
        max_tokens: 4096,
      });
      const finishReason = response.choices[0]?.finish_reason;
      const msg = response.choices[0]?.message as any;
      let content = msg?.content || msg?.reasoning_content || 'I apologize, but I was unable to generate a response.';
      content = content.replace(/<｜｜DSML｜｜[^>]*>[^]*?<\/｜｜DSML｜｜[^>]*>/g, '').trim();
      if (finishReason === 'length') {
        console.warn(`⚠️ DeepSeek response truncated by token limit — ${content.length} chars`);
      }
      return content;
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        provider.available = false;
        this.available = this.providers.some((p) => p.available);
      }
      throw error;
    }
  }

  public async generateStructuredResponse(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 1000
  ): Promise<Record<string, unknown>> {
    const provider = this.getActiveProvider() || this.providers[0] || null;
    if (!provider) throw new Error('No LLM provider available for structured extraction');

    try {
      const client = provider.client as OpenAI;
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const params: Record<string, unknown> = {
        model: provider.model,
        messages,
        temperature: 0.1,
        max_tokens: maxTokens,
      };

      try {
        params.response_format = { type: 'json_object' };
        const response = await client.chat.completions.create(
          params as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
        );
        const msg = response.choices[0]?.message as any;
        const content = msg?.content || msg?.reasoning_content || '{}';
        return JSON.parse(content);
      } catch (formatError: any) {
        if (formatError?.status === 400 || formatError?.message?.includes('response_format')) {
          delete params.response_format;
          const response = await client.chat.completions.create(
            params as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
          );
          const msg = response.choices[0]?.message as any;
          const content = msg?.content || msg?.reasoning_content || '{}';
          const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || content.match(/(\{[\s\S]*\})/);
          const rawJson = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
          const firstBrace = rawJson.indexOf('{');
          const lastBrace = rawJson.lastIndexOf('}');
          const extracted = firstBrace >= 0 && lastBrace > firstBrace ? rawJson.slice(firstBrace, lastBrace + 1) : rawJson;
          return JSON.parse(extracted);
        }
        throw formatError;
      }
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        provider.available = false;
        this.available = this.providers.some((p) => p.available);
      }
      console.error('❌ Structured LLM extraction failed:', error?.message || error);
      return {};
    }
  }

  public async extractJson(
    systemInstruction: string,
    userContent: string,
    maxTokens: number = 1000
  ): Promise<Record<string, unknown>> {
    const provider = this.getActiveProvider() || this.providers[0] || null;
    if (!provider) {
      console.warn('⚠️ No LLM provider available for JSON extraction');
      return {};
    }

    const client = provider.client as OpenAI;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userContent },
    ];

    try {
      const response = await client.chat.completions.create({
        model: provider.model,
        messages,
        temperature: 0.0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      });
      const msg = response.choices[0]?.message as any;
      const content = msg?.content || '{}';
      return JSON.parse(content);
    } catch (error: any) {
      if (error?.status !== 400 && error?.status !== 404 && !error?.message?.includes('response_format')) {
        if (error?.status === 401 || error?.status === 403) {
          provider.available = false;
          this.available = this.providers.some((p) => p.available);
        }
        throw error;
      }
    }

    try {
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: systemInstruction + '\n\nCRITICAL: Your ENTIRE response must be a single valid JSON object. Start with {. End with }. No markdown, no prose, no explanation. JUST JSON.' },
          { role: 'user', content: userContent + '\n\nRespond with ONLY a JSON object. No other text.' },
        ],
        temperature: 0.0,
        max_tokens: maxTokens,
      });
      const msg = response.choices[0]?.message as any;
      let content = msg?.content || '{}';
      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        content = content.slice(firstBrace, lastBrace + 1);
      }
      return JSON.parse(content);
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        provider.available = false;
        this.available = this.providers.some((p) => p.available);
      }
      console.error('❌ JSON extraction failed:', error?.message || error);
      return {};
    }
  }

  public async rankByRelevance(
    query: string,
    candidates: Array<{ id: string; text: string }>
  ): Promise<Array<{ id: string; text: string; score: number }>> {
    const provider = this.getActiveProvider();
    if (!provider || candidates.length === 0) {
      return candidates.map((c) => ({ ...c, score: 0.5 }));
    }

    const itemsText = candidates.map((c, i) => `[${i}] ${c.text}`).join('\n');
    const userContent = `Query: "${query}"\n\nCandidate items:\n${itemsText}\n\nFor each candidate, assign a relevance score from 0.0 (completely irrelevant) to 1.0 (highly relevant).\nReturn ONLY a JSON object in this exact format:\n{"scores": [{"index": 0, "score": 0.95}, {"index": 1, "score": 0.3}, ...]}`;

    let content = '';
    try {
      const client = provider.client as OpenAI;
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: 'You are a semantic relevance ranking engine. Respond ONLY with valid JSON.' },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      });
      const msg = response.choices[0]?.message as any;
      content = msg?.content || msg?.reasoning_content || '';
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        provider.available = false;
        this.available = this.providers.some((p) => p.available);
      }
      return candidates.map((c) => ({ ...c, score: 0.5 }));
    }

    let scores: Array<{ index: number; score: number }> = [];
    try {
      const parsed = JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      scores = parsed.scores || [];
    } catch {
      scores = [];
    }

    const result = candidates.map((c, i) => {
      const match = scores.find((s) => s.index === i);
      return { id: c.id, text: c.text, score: match?.score ?? 0.5 };
    });

    return result.sort((a, b) => b.score - a.score);
  }

  private buildExtractionPrompt(inputText: string, context?: string): string {
    const contextStr = context ? `Context: ${context}\n\n` : '';

    return `${contextStr}You are an advanced cognitive memory extraction system. Extract ALL meaningful information from the text with comprehensive detail and precision.

Text to analyze: "${inputText}"

Return structured JSON with comprehensive detail:
{
  "entities": [
    {
      "name": "exact name or description from text",
      "type": "person|object|concept|place|organization|digital|event|temporal|other",
      "properties": {
        "description": "comprehensive description based on text",
        "attributes": "key characteristics or features mentioned",
        "context": "situational context within the conversation",
        "significance": "importance or relevance indicated",
        "status": "current state or condition if mentioned",
        "temporal_info": "timing, dates, or schedule information",
        "quantitative_info": "numbers, measurements, or quantities",
        "user_perspective": "how the user relates to or feels about this",
        "associated_details": "any additional relevant information"
      },
      "confidence": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "from_entity": "exact entity name",
      "to_entity": "exact entity name",
      "relationship_type": "owns|belongs_to|depends_on|causes|influences|similar_to|part_of|manages|uses|creates|located_at|scheduled_with|related_to",
      "properties": {
        "nature": "detailed description of the relationship",
        "strength": "strong|moderate|weak based on emphasis",
        "direction": "bidirectional|directional|mutual",
        "temporal_context": "when this relationship exists or occurred",
        "conditions": "circumstances or requirements for this relationship",
        "implications": "what this relationship means or enables"
      },
      "confidence": 0.0-1.0
    }
  ],
  "activities": [
    {
      "activity_type": "action|plan|process|decision|problem|solution|goal|learning|communication",
      "description": "detailed description of the activity",
      "participants": ["entities involved"],
      "temporal_info": {
        "timing": "when this occurred or is planned",
        "duration": "how long it takes or took",
        "frequency": "how often this occurs",
        "deadlines": "any time constraints mentioned"
      },
      "context": {
        "motivation": "why this activity is happening",
        "objective": "what the activity aims to achieve",
        "current_status": "progress or completion state",
        "challenges": "difficulties or obstacles mentioned",
        "resources": "what's needed to complete this",
        "success_measures": "how success is defined"
      },
      "confidence": 0.0-1.0
    }
  ],
  "knowledge": [
    {
      "knowledge_type": "preference|skill|procedure|insight|constraint|goal|principle|opinion|question",
      "content": "the actual knowledge or information",
      "domain": "the subject area or field this relates to",
      "context": "situational context and relevance",
      "attributes": {
        "certainty": "certain|likely|uncertain|speculative",
        "importance": "critical|important|useful|minor",
        "actionability": "immediate|planned|reference|general",
        "scope": "personal|professional|general|specific",
        "stability": "permanent|evolving|situational|experimental",
        "emotional_context": "positive|negative|neutral|mixed",
        "expertise_level": "expert|proficient|learning|novice"
      },
      "confidence": 0.0-1.0
    }
  ]
}

CRITICAL RULES:
- Extract ONLY information explicitly stated in the text
- Do not infer, assume, or add details not present
- Adapt entity types and relationship types to match the actual content domain
- Preserve exact terminology and phrasing used by the speaker
- Maintain contextual nuance and emotional undertones`;
  }

  public async generateChatResponse(
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const provider = this.getActiveProvider() || this.providers[0] || null;
    if (!provider) throw new Error('No LLM provider available');

    const { temperature = 0.3, maxTokens = 8000 } = options || {};

    try {
      const client = provider.client as OpenAI;
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature,
        max_tokens: maxTokens,
      });
      const msg = response.choices[0]?.message as any;
      let content = msg?.content || msg?.reasoning_content || '';
      content = content.replace(/<｜f###｜>]*>/g, '').trim();
      return content;
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        provider.available = false;
        this.available = this.providers.some((p) => p.available);
      }
      throw error;
    }
  }

  public isServiceAvailable(): boolean {
    return this.available;
  }

  public async testService(): Promise<{
    success: boolean;
    provider: string;
    model: string;
    response?: string;
    error?: string;
  }> {
    const provider = this.getActiveProvider();
    if (!provider) {
      return { success: false, provider: 'none', model: 'none', error: 'No LLM providers configured or available' };
    }
    try {
      const client = provider.client as OpenAI;
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Respond with valid JSON only.' },
          { role: 'user', content: 'Return this JSON: {"test": "success", "status": "working"}' },
        ],
        temperature: 0.1,
        max_tokens: 100,
      });
      const msg = response.choices[0]?.message as any;
      return {
        success: true,
        provider: provider.name,
        model: provider.model,
        response: msg?.content || msg?.reasoning_content || 'No content',
      };
    } catch (error: any) {
      return {
        success: false,
        provider: provider.name,
        model: provider.model,
        error: error?.message || String(error),
      };
    }
  }

  public getServiceStatus(): { available: boolean; provider: string; model: string; providers: string[] } {
    const active = this.getActiveProvider();
    return {
      available: this.available,
      provider: active?.name || 'none',
      model: active?.model || 'none',
      providers: this.providers.map((p) => `${p.name}(${p.available ? 'ready' : 'unavailable'})`),
    };
  }
}

export const llmService = new LLMService();
