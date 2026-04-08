import OpenAI from 'openai'
import type {ModifyType} from '../graphql/public/resolverTypes'
import type {RetroReflection} from '../postgres/types'
import logError from './logError'
import {Logger} from './Logger'

type InsightResponse = {
  wins: string[]
  challenges: string[]
}

type GroupReflectionsInput = {
  id: string
  text: string
  prompt: string
}

type GroupReflectionsResult = {
  groups: {
    title: string
    reflectionIds: string[]
  }[]
}

class OpenAIServerManager {
  openAIApi
  defaultModel: string
  groupingBatchSize: number
  maxTokens: number
  temperature: number
  topP: number
  constructor() {
    const apiKey = process.env.AI_GENERATION_API_KEY || process.env.OPEN_AI_API_KEY
    if (!apiKey) {
      this.openAIApi = null
      this.defaultModel = ''
      this.groupingBatchSize = 50
      this.maxTokens = 4096
      this.temperature = 0.3
      this.topP = 1
      return
    }
    const baseURL = process.env.AI_GENERATION_BASE_URL || undefined
    this.openAIApi = new OpenAI({
      apiKey,
      ...(baseURL && {baseURL}),
      ...(process.env.OPEN_AI_ORG_ID && {organization: process.env.OPEN_AI_ORG_ID})
    })
    this.defaultModel = process.env.AI_GENERATION_DEFAULT_MODEL || 'gpt-4o'
    this.groupingBatchSize = parseInt(process.env.AI_GROUPING_BATCH_SIZE || '50', 10)
    this.maxTokens = parseInt(process.env.AI_GENERATION_MAX_TOKENS || '4096', 10)
    this.temperature = parseFloat(process.env.AI_GENERATION_TEMPERATURE || '0.3')
    this.topP = parseFloat(process.env.AI_GENERATION_TOP_P || '1')
  }

  private parseLLMJson<T>(rawContent: string, label: string): T | null {
    // Strip markdown fences that local LLMs sometimes add
    const fenceMatch = rawContent.match(/^[\s\S]*?```(?:json)?\s*\n?([\s\S]*?)\n?\s*```[\s\S]*$/)
    const content = fenceMatch ? fenceMatch[1]!.trim() : rawContent.trim()

    try {
      return JSON.parse(content) as T
    } catch {
      Logger.warn(`${label}: Failed to parse JSON response: ${rawContent.slice(0, 500)}`)
      return null
    }
  }

  private async callLLM(
    prompt: string,
    label: string
  ): Promise<{content: string; finishReason: string | null} | null> {
    if (!this.openAIApi) return null
    const baseURL = this.openAIApi.baseURL
    Logger.info(
      `${label}: Sending request to ${baseURL || 'OpenAI'} with model=${this.defaultModel}, prompt length=${prompt.length} chars`
    )

    const response = await this.openAIApi.chat.completions.create({
      model: this.defaultModel,
      messages: [{role: 'user', content: prompt}],
      response_format: {type: 'json_object'},
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP
    })

    let finishReason = response.choices[0]?.finish_reason ?? null
    const usage = response.usage
    // Some LLMs (e.g. via LiteLLM) report "stop" even when hitting max_tokens
    if (finishReason === 'stop' && usage?.completion_tokens && usage.completion_tokens >= this.maxTokens) {
      Logger.warn(`${label}: finish_reason=stop but completion_tokens=${usage.completion_tokens} >= max_tokens=${this.maxTokens}, treating as truncated`)
      finishReason = 'length'
    }
    Logger.info(
      `${label}: Response received. finish_reason=${finishReason}, tokens=${JSON.stringify(usage)}`
    )

    const rawContent = response.choices[0]?.message?.content
    if (!rawContent) {
      Logger.warn(`${label}: LLM returned empty content`)
      return null
    }
    return {content: rawContent, finishReason}
  }

  private repairGroupResult(
    parsed: GroupReflectionsResult,
    inputIds: Set<string>,
    label: string
  ): GroupReflectionsResult | null {
    if (!parsed.groups || !Array.isArray(parsed.groups)) {
      Logger.warn(`${label}: Response missing valid groups array, got keys: ${Object.keys(parsed).join(', ')}`)
      return null
    }

    const seenIds = new Set<string>()
    const repairedGroups: GroupReflectionsResult['groups'] = []

    for (const group of parsed.groups) {
      if (!group.title || !Array.isArray(group.reflectionIds)) {
        Logger.warn(`${label}: Skipping group with missing title or reflectionIds: ${JSON.stringify(group).slice(0, 200)}`)
        continue
      }
      const uniqueIds = group.reflectionIds.filter((id) => {
        if (!inputIds.has(id)) {
          Logger.warn(`${label}: Removing unknown reflection ID: ${id}`)
          return false
        }
        if (seenIds.has(id)) {
          Logger.warn(`${label}: Removing duplicate reflection ID: ${id}`)
          return false
        }
        seenIds.add(id)
        return true
      })
      if (uniqueIds.length > 0) {
        repairedGroups.push({title: group.title, reflectionIds: uniqueIds})
      }
    }

    // Add missing reflections as individual groups
    const missingIds = [...inputIds].filter((id) => !seenIds.has(id))
    if (missingIds.length > 0) {
      Logger.warn(`${label}: ${missingIds.length} reflections were unassigned, adding as individual groups`)
      for (const id of missingIds) {
        repairedGroups.push({title: 'Ungrouped', reflectionIds: [id]})
      }
    }

    if (repairedGroups.length === 0) {
      Logger.warn(`${label}: No valid groups after repair`)
      return null
    }

    return {groups: repairedGroups}
  }

  private buildGroupingPrompt(reflections: GroupReflectionsInput[]): string {
    const min = Math.max(1, Math.floor(reflections.length / 6))
    const max = Math.ceil(reflections.length / 3)

    return `You are an expert facilitator for agile team retrospective meetings. In a retrospective, team members write reflections about their recent work, then group them into themes for focused discussion. Your job is to group reflections in the way that will lead to the most productive team conversations.

Each reflection was written in response to a specific prompt (shown in parentheses). Reflections from different prompts CAN be grouped together when they share a common actionable theme — the prompt category is context, not a hard boundary.

Here are the reflections:
${reflections.map((r) => `[${r.id}] (${r.prompt}): ${r.text}`).join('\n')}

Group these reflections to maximize the value of team discussion. Rules:
- Optimize for actionable conversations: group reflections that, when discussed together, will help the team identify root causes, recognize patterns, or decide on concrete improvements
- Prefer groups that surface tensions or connections the team might not notice on their own (e.g. group a frustration with a related success to spark deeper insight)
- Each reflection must belong to exactly one group
- Aim for ${min} to ${max} groups, but adjust if the reflections naturally cluster differently
- Reflections that don't clearly relate to others should remain in their own single-reflection group
- Group titles should be 2-5 words, action-oriented, and describe what the team should discuss (e.g. "Speed Up Code Reviews" not "Code Reviews", "Celebrate Ship Velocity" not "Shipping")
- Titles must be distinct from each other

Return JSON: { "groups": [{ "title": "...", "reflectionIds": ["id1", "id2"] }] }`
  }

  private async groupReflectionBatch(
    batch: GroupReflectionsInput[],
    batchIndex: number,
    totalBatches: number,
    depth = 0
  ): Promise<GroupReflectionsResult | null> {
    const label = `groupBatch[${batchIndex + 1}/${totalBatches}${depth > 0 ? `:d${depth}` : ''}]`
    Logger.info(`${label}: Grouping ${batch.length} reflections...`)

    try {
      const prompt = this.buildGroupingPrompt(batch)
      const result = await this.callLLM(prompt, label)
      if (!result) return null

      const {content: rawContent, finishReason} = result

      // Detect truncation and retry with smaller batches
      if (finishReason === 'length') {
        if (batch.length <= 2 || depth >= 5) {
          Logger.warn(`${label}: Truncated and cannot split further (size=${batch.length}, depth=${depth})`)
          return null
        }
        const mid = Math.ceil(batch.length / 2)
        const firstHalf = batch.slice(0, mid)
        const secondHalf = batch.slice(mid)
        Logger.warn(
          `${label}: Truncated (finish_reason=length), splitting into sub-batches of ${firstHalf.length} and ${secondHalf.length}`
        )
        const [result1, result2] = await Promise.all([
          this.groupReflectionBatch(firstHalf, batchIndex, totalBatches, depth + 1),
          this.groupReflectionBatch(secondHalf, batchIndex, totalBatches, depth + 1)
        ])
        if (!result1 || !result2) return null
        return {groups: [...result1.groups, ...result2.groups]}
      }

      const parsed = this.parseLLMJson<GroupReflectionsResult>(rawContent, label)
      if (!parsed) return null

      const inputIds = new Set(batch.map((r) => r.id))
      const repaired = this.repairGroupResult(parsed, inputIds, label)
      if (!repaired) return null

      Logger.info(`${label}: Success — ${repaired.groups.length} groups created`)
      return repaired
    } catch (e) {
      const error = e instanceof Error ? e : new Error(`LLM failed for ${label}`)
      logError(error)
      return null
    }
  }

  private async mergeGroupTitles(
    batchResults: GroupReflectionsResult[]
  ): Promise<GroupReflectionsResult> {
    const allGroups = batchResults.flatMap((r) => r.groups)
    const label = 'mergeGroups'
    Logger.info(`${label}: Merging ${allGroups.length} groups from ${batchResults.length} batches...`)

    const prompt = `You are merging reflection groups from a retrospective meeting. Multiple batches produced these groups. Merge groups that cover the same theme into a single group with a clear, action-oriented title (2-5 words).

Groups:
${allGroups.map((g, i) => `${i}: "${g.title}" (${g.reflectionIds.length} reflections)`).join('\n')}

Rules:
- Merge groups with similar or overlapping themes
- Keep groups separate if they represent genuinely different topics
- Each merged group gets a new title that captures the combined theme
- Groups that don't match any other group stay as-is

Return JSON: { "merges": [{ "finalTitle": "...", "groupIndices": [0, 3, 7] }] }
Every group index (0 to ${allGroups.length - 1}) must appear in exactly one merge entry.`

    try {
      const result = await this.callLLM(prompt, label)
      if (!result) {
        Logger.warn(`${label}: LLM merge failed, returning unmerged groups`)
        return {groups: allGroups}
      }
      const {content: rawContent} = result

      type MergeResult = {merges: {finalTitle: string; groupIndices: number[]}[]}
      const parsed = this.parseLLMJson<MergeResult>(rawContent, label)
      if (!parsed?.merges || !Array.isArray(parsed.merges)) {
        Logger.warn(`${label}: Invalid merge response, returning unmerged groups`)
        return {groups: allGroups}
      }

      // Build merged groups
      const usedIndices = new Set<number>()
      const mergedGroups: GroupReflectionsResult['groups'] = []

      for (const merge of parsed.merges) {
        if (!merge.finalTitle || !Array.isArray(merge.groupIndices)) continue
        const reflectionIds: string[] = []
        for (const idx of merge.groupIndices) {
          if (idx < 0 || idx >= allGroups.length || usedIndices.has(idx)) continue
          usedIndices.add(idx)
          reflectionIds.push(...allGroups[idx]!.reflectionIds)
        }
        if (reflectionIds.length > 0) {
          mergedGroups.push({title: merge.finalTitle, reflectionIds})
        }
      }

      // Add any groups the LLM missed
      for (let i = 0; i < allGroups.length; i++) {
        if (!usedIndices.has(i)) {
          mergedGroups.push(allGroups[i]!)
        }
      }

      Logger.info(`${label}: Merged ${allGroups.length} groups into ${mergedGroups.length}`)
      return {groups: mergedGroups}
    } catch (e) {
      Logger.warn(`${label}: Merge error, returning unmerged groups`)
      return {groups: allGroups}
    }
  }

  async groupReflectionsStructured(
    reflections: GroupReflectionsInput[]
  ): Promise<GroupReflectionsResult | null> {
    if (!this.openAIApi) return null
    if (reflections.length === 0) return null

    // Small meetings: single call (original behavior)
    if (reflections.length <= this.groupingBatchSize) {
      try {
        const prompt = this.buildGroupingPrompt(reflections)
        const label = 'groupReflectionsStructured'
        const result = await this.callLLM(prompt, label)
        if (!result) return null

        // If truncated in single-call mode, fall through to batched approach
        if (result.finishReason === 'length') {
          Logger.warn(`${label}: Single-call truncated, falling through to batched approach`)
        } else {
          const parsed = this.parseLLMJson<GroupReflectionsResult>(result.content, label)
          if (!parsed) return null

          const inputIds = new Set(reflections.map((r) => r.id))
          return this.repairGroupResult(parsed, inputIds, label)
        }
      } catch (e) {
        const error =
          e instanceof Error ? e : new Error('OpenAI failed to groupReflectionsStructured')
        logError(error)
        return null
      }
    }

    // Large meetings: batched approach
    Logger.info(
      `groupReflectionsStructured: ${reflections.length} reflections exceeds batch size ${this.groupingBatchSize}, using batched approach`
    )

    const batches: GroupReflectionsInput[][] = []
    for (let i = 0; i < reflections.length; i += this.groupingBatchSize) {
      batches.push(reflections.slice(i, i + this.groupingBatchSize))
    }

    // Step 1: Group each batch sequentially
    const batchResults: GroupReflectionsResult[] = []
    for (let i = 0; i < batches.length; i++) {
      const result = await this.groupReflectionBatch(batches[i]!, i, batches.length)
      if (!result) {
        Logger.warn(`groupReflectionsStructured: Batch ${i + 1}/${batches.length} failed, adding reflections as ungrouped`)
        batchResults.push({
          groups: batches[i]!.map((r) => ({title: 'Ungrouped', reflectionIds: [r.id]}))
        })
        continue
      }
      batchResults.push(result)
    }

    // Step 2: Merge similar groups across batches
    const merged = await this.mergeGroupTitles(batchResults)

    // Step 3: Final repair
    const inputIds = new Set(reflections.map((r) => r.id))
    const finalResult = this.repairGroupResult(merged, inputIds, 'groupReflectionsStructured:final')
    if (!finalResult) return null

    Logger.info(
      `groupReflectionsStructured: Batched grouping complete — ${finalResult.groups.length} final groups from ${reflections.length} reflections`
    )
    return finalResult
  }

  async getStandupSummary(
    responses: Array<{content: string; user: string}>,
    meetingPrompt: string
  ) {
    if (!this.openAIApi) return null

    const prompt = `Below is a list of responses submitted by team members to the question "${meetingPrompt}". Each response includes the team member's name. Identify up to 3 key themes found within the responses. For each theme, provide a single concise sentence that includes who is working on what. Use "they/them" pronouns when referring to people.

    Desired format:
    - <theme>: <brief summary including names>
    - <theme>: <brief summary including names>
    - <theme>: <brief summary including names>

    Responses: """
    ${responses.map(({content, user}) => `${user}: ${content}`).join('\nNEW_RESPONSE\n')}
    """`

    try {
      const response = await this.openAIApi.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })
      return (response.choices[0]?.message?.content?.trim() as string) ?? null
    } catch (e) {
      const error = e instanceof Error ? e : new Error('OpenAI failed to getSummary')
      logError(error)
      return null
    }
  }

  async getDiscussionPromptQuestion(topic: string, reflections: RetroReflection[]) {
    if (!this.openAIApi) return null
    const prompt = `As the meeting facilitator, your task is to steer the discussion in a productive direction. I will provide you with a topic and comments made by the participants around that topic. Your job is to generate a thought-provoking question based on these inputs. Here's how to do it step by step:

    Step 1: Categorize the discussion into one of the following four groups:

    Group 1: Requirement/Seeking help/Requesting permission
    Example Question: "What specific assistance do you need to move forward?"

    Group 2: Retrospection/Post-mortem/Looking back/Incident analysis/Root cause analysis
    Example Question: "What were the underlying factors contributing to the situation?"

    Group 3: Improvement/Measurement/Experiment
    Example Question: "What factors are you aiming to optimize or minimize?"

    Group 4: New plan/New feature/New launch/Exploring new approaches
    Example Question: "How can we expedite the learning process or streamline our approach?"

    Step 2: Once you have categorized the topic, formulate a question that aligns with the example question provided for that group. If the topic does not belong to any of the groups, come up with a good question yourself for a productive discussion.

    Step 3: Finally, provide me with the question you have formulated without disclosing any information about the group it belongs to. When referring to people in the summary, do not assume their gender and default to using the pronouns "they" and "them".

    Topic: ${topic}
    Comments:
    ${reflections
      .map(({plaintextContent}) => plaintextContent.trim().replace(/\n/g, '\t'))
      .join('\n')}`
    try {
      const response = await this.openAIApi.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 80
      })
      const question =
        (response.choices[0]?.message?.content?.trim() as string).replace(
          /^[Qq]uestion:*\s*/gi,
          ''
        ) ?? null
      return question ? question.replace(/['"]+/g, '') : null
    } catch (e) {
      const error =
        e instanceof Error
          ? e
          : new Error(`OpenAI failed to generate a question for the topic ${topic}`)
      logError(error)
      return null
    }
  }

  async modifyCheckInQuestion(question: string, modifyType: ModifyType) {
    if (!this.openAIApi) return null

    const maxQuestionLength = 160
    const prompt: Record<ModifyType, string> = {
      EXCITING: `Transform the following team retrospective ice breaker question into something imaginative and unexpected, using simple and clear language suitable for an international audience. Keep it engaging and thrilling, while ensuring it's easy to understand. Ensure the modified question does not exceed ${maxQuestionLength} characters.
      Original question: "${question}"`,

      FUNNY: `Rewrite the following team retrospective ice breaker question to add humor, using straightforward and easy-to-understand language. Aim for a light-hearted, amusing twist that is accessible to an international audience. Ensure the modified question does not exceed ${maxQuestionLength} characters.
      Original question: "${question}"`,

      SERIOUS: `Modify the following team retrospective ice breaker question to make it more thought-provoking, using clear and simple language. Make it profound to stimulate insightful discussions, while ensuring it remains comprehensible to a diverse international audience. Ensure the modified question does not exceed ${maxQuestionLength} characters.
      Original question: "${question}"`
    }

    try {
      const response = await this.openAIApi.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: prompt[modifyType]
          }
        ],
        temperature: 0.8,
        max_tokens: 256,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })

      return (response.choices[0]?.message?.content?.trim() as string).replaceAll(`"`, '') ?? null
    } catch (e) {
      const error = e instanceof Error ? e : new Error('OpenAI failed to modifyCheckInQuestion')
      logError(error)
      return null
    }
  }

  async generateInsight(
    yamlData: string,
    useSummaries: boolean,
    userPrompt?: string | null
  ): Promise<InsightResponse | null> {
    if (!this.openAIApi) return null
    const meetingURL = `https://${process.env.HOST}/meet/[meetingId]`
    const promptForMeetingData = `
You are a Team Lead and want to use your meeting data to help write a report on your team's performance. You care about team productivity, morale, roadblocks, relationships, and progress against goals. Below is a list of retrospective meeting summaries (in YAML format) from the past several months.

**Task:**
Analyze the provided meeting data and identify patterns in teamwork and collaboration. Focus on "wins" and "challenges" that appear in two or more different meetings, prioritizing trends that appear in the highest number of meetings. Reference those meetings by hyperlink. Prioritize trends that have received the most combined votes, if that information is available.

**Output Format:**
Return the analysis as a JSON object with this structure:
{
  "wins": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "challenges": ["bullet point 1", "bullet point 2", "bullet point 3"]
}

**Instructions:**
1. **Wins (3 bullet points)**:
   - Highlight positive trends or patterns observed across multiple meetings.
   - Include at least one direct quote from one meeting, attributing it to its author.
   - Link to the referenced meeting(s) using the format:
     [<meeting title>](${meetingURL})
   - Mention each author at most once across the entire output.
   - Keep the tone kind, straightforward, and professional. Avoid jargon.

2. **Challenges (3 bullet points)**:
   - Highlight trends or patterns that indicate areas for improvement.
   - Include at least one direct quote from one meeting, attributing it to its author.
   - Suggest a concrete action or next step to improve the situation.
   - Link to the referenced meeting(s) using the format:
     [<meeting title>](${meetingURL})
   - Mention each author at most once across the entire output.
   - Keep the tone kind, straightforward, and professional. Avoid jargon.

3. **References to Meetings**:
   - Each bullet point in both "wins" and "challenges" should reference at least one meeting.
   - Ensure that each cited trend is supported by data from at least two different meetings.

4. **Key Focus Areas**:
   Consider the following when choosing trends:
   - What is the team's core work? Are desired outcomes clear, and how are they measured?
   - Who utilizes the team's work, and what do they need?
   - Does the team collaborate effectively with related teams?
   - How does the team prioritize its work?
   - What factors speed up or slow down progress?
   - What habits, rules, or rituals help or hinder performance?

5. **Translation**:
   - If the source language of the meetings tends not to be English, identify the language and translate your output to this language

6. **Final Answer**:
   - Return only the JSON object.
   - No extraneous text, explanations, or commentary outside the JSON object.`

    const promptForSummaries = `
    You work at a start-up and you need to discover behavioral trends for a given team.
    Below is a list of meeting summaries in YAML format from meetings over recent months.
    You should describe the situation in two sections with exactly 3 bullet points each.
    The first section should describe the team's positive behavior in bullet points.
    The second section should pick out one or two examples of the team's negative behavior.
    Cite direct quotes from the meeting, attributing them to the person who wrote it, if they're included in the summary.
    Include discussion links included in the summaries. They must be in the markdown format of [link](${meetingURL}/discuss/[discussionId]).
    Try to spot trends. If a topic comes up in several summaries, prioritize it.
    The most important topics are usually at the beginning of each summary, so prioritize them.
    Don't repeat the same points in both the wins and challenges.
    Return the output as a JSON object with the following structure:
    {
      "wins": ["bullet point 1", "bullet point 2", "bullet point 3"],
      "challenges": ["bullet point 1", "bullet point 2"]
    }
    Your tone should be kind and straight forward. Use plain English. No yapping.
    `

    const defaultPrompt = useSummaries ? promptForSummaries : promptForMeetingData
    const prompt = userPrompt ? userPrompt : defaultPrompt

    try {
      const response = await this.openAIApi.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\n${yamlData}`
          }
        ],
        response_format: {
          type: 'json_object'
        },
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })

      const completionContent = response.choices[0]?.message.content as string

      let data: InsightResponse
      try {
        data = JSON.parse(completionContent)
      } catch (e) {
        const error = e instanceof Error ? e : new Error('Error parsing JSON in generateInsight')
        logError(error)
        return null
      }

      return data
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Error in generateInsight')
      logError(error)
      return null
    }
  }

  async generateSummary(yamlData: string, userPrompt?: string | null): Promise<string | null> {
    if (!this.openAIApi) return null
    const meetingURL = `https://${process.env.HOST}/meet`
    const defaultPrompt = `
    You need to summarize the content of a meeting. Your summary must be one paragraph with no more than a two or three sentences.
    Below is a list of reflection topics and comments in YAML format from the meeting.
    Include quotes from the meeting, and mention the author.
    Link directly to the discussion in the markdown format of [link](${meetingURL}/[meetingId]/discuss/[discussionId]).
    Don't mention the name of the meeting.
    Prioritise the topics that got the most votes.
    Be sure that each author is only mentioned once.
    Your output must be a string.
    The most important topics are the ones that got the most votes.
    Start the summary with the most important topic.
    You do not need to mention everything. Just mention the most important points, and ensure the summary is concise.
    Your tone should be kind. Write in plain English. No jargon.
    Do not add quote marks around the whole summary.
    `
    const prompt = userPrompt ? userPrompt : defaultPrompt

    try {
      const response = await this.openAIApi.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\n${yamlData}`
          }
        ],

        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })

      const content = response.choices[0]?.message.content as string
      return content
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Error in generateInsight')
      logError(error)
      return null
    }
  }

  async generateGroupTitle(reflections: {plaintextContent: string}[]) {
    if (!this.openAIApi) return null
    const prompt = `Generate a short (2-4 words) theme or title that captures the essence of these related retrospective comments. The title should be clear and actionable.

${reflections.map((r) => r.plaintextContent).join('\n')}

Important: Respond with ONLY the title itself. Do not include any prefixes like "Title:" or any quote marks. Do not provide any additional explanation.`

    try {
      const response = await this.openAIApi.chat.completions.create({
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 20,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })
      const title =
        (response.choices[0]?.message?.content?.trim() as string)
          ?.replace(/^[Tt]itle:*\s*/gi, '') // Remove "Title:" prefix
          ?.replaceAll(/['"]/g, '') ?? null

      return title
    } catch (e) {
      const error = e instanceof Error ? e : new Error('OpenAI failed to generate group title')
      logError(error)
      return null
    }
  }
}

export default OpenAIServerManager
