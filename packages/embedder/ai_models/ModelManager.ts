import type {AbstractEmbeddingsModel} from './AbstractEmbeddingsModel'
import type {AbstractGenerationModel} from './AbstractGenerationModel'
import type {ModelId} from './modelIdDefinitions'
import OpenAIEmbedding from './OpenAIEmbedding'
import OpenAIGeneration from './OpenAIGeneration'
import {
  type EmbeddingsModelType,
  type GenerationModelType,
  parseModelEnvVars
} from './parseModelEnvVars'
import TextEmbeddingsInference from './TextEmbeddingsInference'
import TextGenerationInference from './TextGenerationInference'

const defaultProviderType = process.env.AI_PROVIDER_TYPE || 'openai'

function parseModelTypeAndId(model: string, fallbackType: string): [string, string] {
  const colonIdx = model.indexOf(':')
  if (colonIdx === -1) return [fallbackType, model]
  return [model.slice(0, colonIdx), model.slice(colonIdx + 1)]
}

export class ModelManager {
  embeddingModels: Map<ModelId, AbstractEmbeddingsModel>
  generationModels: Map<string, AbstractGenerationModel>
  getEmbedder(modelId?: ModelId): AbstractEmbeddingsModel {
    return modelId
      ? this.embeddingModels.get(modelId)!
      : this.embeddingModels.values().next().value!
  }

  constructor() {
    // Initialize embeddings models
    const embeddingConfig = parseModelEnvVars('AI_EMBEDDING_MODELS')
    this.embeddingModels = new Map(
      embeddingConfig.map((modelConfig) => {
        const {model, url, maxTokens} = modelConfig
        const [modelType, modelId] = parseModelTypeAndId(model, defaultProviderType) as [EmbeddingsModelType, ModelId]
        switch (modelType) {
          case 'text-embeddings-inference': {
            const embeddingsModel = new TextEmbeddingsInference(modelId, url, maxTokens)
            return [modelId, embeddingsModel] as [ModelId, AbstractEmbeddingsModel]
          }
          case 'vllm':
          case 'openai': {
            const openAIModel = new OpenAIEmbedding(modelId, url, maxTokens)
            return [modelId, openAIModel] as [ModelId, AbstractEmbeddingsModel]
          }
          default:
            throw new Error(`unsupported embeddings model type '${modelType}'. Use 'vllm', 'openai', or 'text-embeddings-inference'`)
        }
      })
    )

    // Initialize generation models
    const generationConfig = parseModelEnvVars('AI_GENERATION_MODELS')
    this.generationModels = new Map<string, AbstractGenerationModel>(
      generationConfig.map((modelConfig) => {
        const {model, url} = modelConfig
        const [modelType, modelId] = parseModelTypeAndId(model, defaultProviderType) as [GenerationModelType, string]
        switch (modelType) {
          case 'openai':
          case 'vllm': {
            return [modelId, new OpenAIGeneration(modelId, url)]
          }
          case 'text-generation-inference': {
            return [modelId, new TextGenerationInference(modelId, url)]
          }
          default:
            throw new Error(`unsupported generation model type '${modelType}'. Use 'openai', 'vllm', or 'text-generation-inference'`)
        }
      })
    )
  }

  async maybeCreateTables() {
    return Promise.all([...this.embeddingModels].map(([, model]) => model.createTable()))
  }
}

let modelManager: ModelManager | undefined
export function getModelManager() {
  if (!modelManager) {
    modelManager = new ModelManager()
  }
  return modelManager
}

export default getModelManager
