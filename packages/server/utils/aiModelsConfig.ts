import {Logger} from './Logger'

export type GenerationModelConfig = {
  model: string
  maxTokens: number
  temperature: number
  topP: number
}

export type EmbeddingModelConfig = {
  model: string
  maxTokens: number
  dimensions: number
  threshold: number
}

export type AIProviderConfig = {
  type: string
  baseURL: string
  apiKey: string
}

export function getAIProviderConfig(): AIProviderConfig | null {
  // New env vars
  const apiKey = process.env.AI_PROVIDER_API_KEY
    || process.env.AI_GENERATION_API_KEY
    || process.env.OPEN_AI_API_KEY
  if (!apiKey) return null

  const baseURL = process.env.AI_PROVIDER_BASE_URL
    || process.env.AI_GENERATION_BASE_URL
    || ''
  const type = process.env.AI_PROVIDER_TYPE || 'openai'

  return {type, baseURL, apiKey}
}

export function getGenerationModels(): GenerationModelConfig[] {
  const raw = process.env.AI_GENERATION_MODELS
  if (!raw) {
    // Legacy fallback: construct single model from old env vars
    const model = process.env.AI_GENERATION_DEFAULT_MODEL || 'gpt-4o'
    return [{
      model,
      maxTokens: parseInt(process.env.AI_GENERATION_MAX_TOKENS || '4096', 10),
      temperature: parseFloat(process.env.AI_GENERATION_TEMPERATURE || '0.3'),
      topP: parseFloat(process.env.AI_GENERATION_TOP_P || '1')
    }]
  }

  try {
    const parsed = JSON.parse(raw) as any[]
    return parsed.map((m) => ({
      model: m.model,
      maxTokens: m.maxTokens ?? 4096,
      temperature: m.temperature ?? 0.3,
      topP: m.top_p ?? m.topP ?? 1
    }))
  } catch {
    Logger.warn('aiModelsConfig: Failed to parse AI_GENERATION_MODELS, using defaults')
    return [{model: 'gpt-4o', maxTokens: 4096, temperature: 0.3, topP: 1}]
  }
}

export function getEmbeddingModels(): EmbeddingModelConfig[] {
  const raw = process.env.AI_EMBEDDING_MODELS
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as any[]
    return parsed.map((m) => ({
      model: m.model,
      maxTokens: m.maxTokens ?? 8192,
      dimensions: m.dimensions ?? 1024,
      threshold: m.threshold ?? 0.65
    }))
  } catch {
    Logger.warn('aiModelsConfig: Failed to parse AI_EMBEDDING_MODELS')
    return []
  }
}

export function getGroupingStrategy(): 'generative' | 'embedding' {
  return (process.env.AI_GROUPING_STRATEGY || 'generative') as 'generative' | 'embedding'
}

export function getGroupingBatchSize(): number {
  return parseInt(process.env.AI_GROUPING_BATCH_SIZE || '50', 10)
}

export type GroupingModelInfo = {
  name: string
  type: 'generative' | 'embedding'
}

export function getAvailableGroupingModels(): GroupingModelInfo[] {
  const models: GroupingModelInfo[] = []
  for (const m of getGenerationModels()) {
    models.push({name: m.model, type: 'generative'})
  }
  for (const m of getEmbeddingModels()) {
    models.push({name: m.model, type: 'embedding'})
  }
  return models
}
