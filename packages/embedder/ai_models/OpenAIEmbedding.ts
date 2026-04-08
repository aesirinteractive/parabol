import OpenAI from 'openai'
import {AbstractEmbeddingsModel, type EmbeddingModelParams} from './AbstractEmbeddingsModel'
import {getEmbeddingModelParams} from './modelIdDefinitions'

export class OpenAIEmbedding extends AbstractEmbeddingsModel {
  client: OpenAI
  url: string
  modelId: string
  constructor(modelId: string, url: string, maxTokens: number) {
    super(modelId, url, maxTokens)
    this.url = url
    this.modelId = modelId
    this.client = new OpenAI({
      apiKey: process.env.AI_EMBEDDING_API_KEY || 'vllm',
      baseURL: url
    })
  }

  async ready() {
    return true
  }
  async getTokens(content: string) {
    if (!content) return []
    const res = await fetch(this.url, {
      method: 'post',
      body: JSON.stringify({
        model: this.modelId,
        prompt: content
      })
    })
    const resJSON = await res.json()
    console.log({resJSON})
    const {tokens} = resJSON
    return tokens
  }

  public async getEmbedding(content: string): Promise<number[] | Error> {
    const {data} = await this.client.embeddings.create({
      input: content,
      model: this.modelId,
      dimensions: this.embeddingDimensions
    })
    return data[0]?.embedding ?? []
  }

  protected constructModelParams(modelId: string): EmbeddingModelParams {
    const modelParams = getEmbeddingModelParams(modelId)
    if (!modelParams) throw new Error(`Unknown embedding model "${modelId}". Add it to modelIdDefinitions.ts with embeddingDimensions, precision, tableSuffix, and languages.`)
    return modelParams
  }
}

export default OpenAIEmbedding
