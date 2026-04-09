import {type ModelId} from './ai_models/modelIdDefinitions'
import {parseModelEnvVars} from './ai_models/parseModelEnvVars'

// The goal here is to have a string constant of the table name available to the server
// Without importing all the abstract model classes

const getFirstModelId = () => {
  const embeddingConfig = parseModelEnvVars('AI_EMBEDDING_MODELS')
  const firstEmbeddingConfig = embeddingConfig[0]
  if (!firstEmbeddingConfig) return null
  const {model} = firstEmbeddingConfig
  // Support both "provider:modelId" format and plain "modelId" format
  const parts = model.split(':')
  return (parts.length > 1 ? parts[1] : parts[0]) as ModelId
}
export const activeEmbeddingModelId = getFirstModelId()
