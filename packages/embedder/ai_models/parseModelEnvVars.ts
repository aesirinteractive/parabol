export type EmbeddingsModelType = 'text-embeddings-inference' | 'vllm'
export type GenerationModelType = 'openai' | 'text-generation-inference'

export interface ModelConfig {
  model: string
  url: string
  maxTokens: number
}

export const parseModelEnvVars = (
  envVar: 'AI_EMBEDDING_MODELS' | 'AI_GENERATION_MODELS'
): ModelConfig[] => {
  const envValue = process.env[envVar]
  if (!envValue) return []
  let models
  try {
    models = JSON.parse(envValue)
  } catch {
    throw new Error(`Invalid Env Var: ${envVar}. Must be a valid JSON`)
  }

  if (!Array.isArray(models)) {
    throw new Error(`Invalid Env Var: ${envVar}. Must be an array`)
  }

  const defaultUrl = process.env.AI_PROVIDER_BASE_URL || ''

  models.forEach((model, idx) => {
    if (typeof model.model !== 'string') {
      throw new Error(`Invalid Env Var: ${envVar}. Invalid "model" at index ${idx}`)
    }
    if (typeof model.maxTokens !== 'number') {
      throw new Error(`Invalid Env Var: ${envVar}. Invalid "maxTokens" at index ${idx}`)
    }
    // url is optional — falls back to AI_PROVIDER_BASE_URL
    if (model.url == null) {
      model.url = defaultUrl
    }
    if (typeof model.url !== 'string') {
      throw new Error(`Invalid Env Var: ${envVar}. Invalid "url" at index ${idx}`)
    }
  })
  return models
}
