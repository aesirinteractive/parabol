import {SubscriptionChannel} from '../../../../client/types/constEnums'
import getKysely from '../../../postgres/getKysely'
import {analytics} from '../../../utils/analytics/analytics'
import {getUserId} from '../../../utils/authorization'
import OpenAIServerManager from '../../../utils/OpenAIServerManager'
import publish from '../../../utils/publish'
import standardError from '../../../utils/standardError'
import type {GQLContext} from '../../graphql'
import canAccessAI from '../../mutations/helpers/canAccessAI'
import addReflectionToGroup from '../../mutations/helpers/updateReflectionLocation/addReflectionToGroup'
import type {MutationResolvers} from '../resolverTypes'

const autogroup: MutationResolvers['autogroup'] = async (
  _source,
  {meetingId}: {meetingId: string},
  context: GQLContext
) => {
  const pg = getKysely()
  const {authToken, dataLoader, socketId: mutatorId} = context
  const viewerId = getUserId(authToken)
  const operationId = dataLoader.share()
  const subOptions = {operationId, mutatorId}
  const [meeting, reflections, reflectionGroups, viewer] = await Promise.all([
    dataLoader.get('newMeetings').load(meetingId),
    dataLoader.get('retroReflectionsByMeetingId').load(meetingId),
    dataLoader.get('retroReflectionGroupsByMeetingId').load(meetingId),
    dataLoader.get('users').loadNonNull(viewerId)
  ])

  if (!meeting) {
    return standardError(new Error('Meeting not found'), {userId: viewerId})
  }

  if (meeting.meetingType !== 'retrospective') {
    return standardError(new Error('Incorrect meeting type'), {
      userId: viewerId
    })
  }

  const {teamId} = meeting
  const team = await dataLoader.get('teams').loadNonNull(teamId)
  if (!(await canAccessAI(team, dataLoader))) {
    return standardError(new Error('AI access is not available'), {userId: viewerId})
  }

  const resetReflectionGroups = reflectionGroups.map((group) => {
    const {id, title} = group
    const reflectionIds = reflections
      .filter(({reflectionGroupId}) => reflectionGroupId === id)
      .map(({id}) => id)
    return {
      groupTitle: title ?? '',
      reflectionIds
    }
  })

  const manager = new OpenAIServerManager()
  const promptIds = [...new Set(reflections.map((r) => r.promptId))]
  const prompts = await Promise.all(
    promptIds.map((id) => dataLoader.get('reflectPrompts').loadNonNull(id))
  )
  const promptMap = new Map(prompts.map((p) => [p.id, p.question]))
  const input = reflections.map((r) => ({
    id: r.id,
    text: r.plaintextContent,
    prompt: promptMap.get(r.promptId) ?? ''
  }))
  const aiResult = await manager.groupReflectionsStructured(input)
  if (!aiResult) {
    return standardError(new Error('AI grouping failed'), {userId: viewerId})
  }

  await Promise.all([
    ...aiResult.groups.flatMap((group) => {
      const {title: groupTitle, reflectionIds} = group
      const reflectionsInGroup = reflections.filter(({id}) => reflectionIds.includes(id))
      const firstReflectionInGroup = reflectionsInGroup[0]
      if (!firstReflectionInGroup) {
        return []
      }
      return reflectionsInGroup.map((reflection) =>
        addReflectionToGroup(
          reflection.id,
          firstReflectionInGroup.reflectionGroupId,
          context,
          groupTitle
        )
      )
    }),
    pg
      .updateTable('NewMeeting')
      .set({resetReflectionGroups: JSON.stringify(resetReflectionGroups)})
      .where('id', '=', meetingId)
      .execute()
  ])
  meeting.resetReflectionGroups = resetReflectionGroups
  analytics.suggestGroupsClicked(viewer, meetingId, teamId)
  const data = {meetingId}
  publish(SubscriptionChannel.MEETING, meetingId, 'AutogroupSuccess', data, subOptions)
  return data
}

export default autogroup
