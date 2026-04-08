import OpenAI from 'openai'
import {Logger} from '../../server/utils/Logger'
import {
  AbstractGenerationModel,
  type GenerationModelParams,
  type GenerationOptions
} from './AbstractGenerationModel'

type OpenAIGenerationOptions = Omit<GenerationOptions, 'topK'>

const knownModels: Record<string, GenerationModelParams> = {
  'gpt-3.5-turbo-0125': {
    maxInputTokens: 4096
  },
  'gpt-4-turbo-preview': {
    maxInputTokens: 128000
  }
}

const DEFAULT_GENERATION_PARAMS: GenerationModelParams = {
  maxInputTokens: 32768
}

export class OpenAIGeneration extends AbstractGenerationModel {
  private openAIApi: OpenAI | null
  private modelId!: string

  constructor(modelId: string, url: string) {
    super(modelId, url)
    const apiKey = process.env.AI_GENERATION_API_KEY || process.env.OPEN_AI_API_KEY
    if (!apiKey) {
      this.openAIApi = null
      return
    }
    this.openAIApi = new OpenAI({
      apiKey,
      ...(url && {baseURL: url}),
      ...(process.env.OPEN_AI_ORG_ID && {organization: process.env.OPEN_AI_ORG_ID})
    })
  }

  async summarize(content: string, options: OpenAIGenerationOptions) {
    if (!this.openAIApi) {
      const eMsg = 'OpenAI is not configured'
      Logger.log('OpenAIGenerationSummarizer.summarize(): ', eMsg)
      throw new Error(eMsg)
    }
    const {maxNewTokens: max_tokens = 512, seed, stop, temperature = 0.8, topP: top_p} = options
    const prompt = `Create a brief, one-paragraph summary of the following: ${content}`

    try {
      const response = await this.openAIApi.chat.completions.create({
        frequency_penalty: 0,
        max_tokens,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.modelId,
        presence_penalty: 0,
        temperature,
        seed,
        stop,
        top_p
      })
      const maybeSummary = response.choices[0]?.message?.content?.trim()
      if (!maybeSummary) throw new Error('OpenAI returned empty summary')
      return maybeSummary
    } catch (e) {
      Logger.log('OpenAIGenerationSummarizer.summarize(): ', e)
      throw e
    }
  }
  protected constructModelParams(modelId: string): GenerationModelParams {
    const modelParams = knownModels[modelId]
    if (!modelParams) {
      Logger.info(`OpenAIGeneration: Unknown model "${modelId}", using default params (maxInputTokens=${DEFAULT_GENERATION_PARAMS.maxInputTokens})`)
      return DEFAULT_GENERATION_PARAMS
    }
    return modelParams
  }
}

export default OpenAIGeneration
