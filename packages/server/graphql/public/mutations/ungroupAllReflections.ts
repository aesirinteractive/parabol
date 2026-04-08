import {SubscriptionChannel} from '../../../../client/types/constEnums'
import {getUserId, isTeamMember} from '../../../utils/authorization'
import publish from '../../../utils/publish'
import standardError from '../../../utils/standardError'
import type {GQLContext} from '../../graphql'
import removeReflectionFromGroup from '../../mutations/helpers/updateReflectionLocation/removeReflectionFromGroup'
import type {MutationResolvers} from '../resolverTypes'

const ungroupAllReflections: MutationResolvers['ungroupAllReflections'] = async (
  _source,
  {meetingId}: {meetingId: string},
  context: GQLContext
) => {
  const {authToken, dataLoader, socketId: mutatorId} = context
  const operationId = dataLoader.share()
  const subOptions = {operationId, mutatorId}
  const viewerId = getUserId(authToken)
  const meeting = await dataLoader.get('newMeetings').load(meetingId)

  if (!meeting) {
    return standardError(new Error('Meeting not found'), {userId: viewerId})
  }

  if (meeting.meetingType !== 'retrospective') {
    return standardError(new Error('Incorrect meeting type'), {userId: viewerId})
  }

  const {teamId} = meeting
  if (!isTeamMember(authToken, teamId)) {
    return standardError(new Error('Not on team'), {userId: viewerId})
  }

  const reflections = await dataLoader.get('retroReflectionsByMeetingId').load(meetingId)

  // Build a map of reflectionGroupId -> reflectionIds
  const groupReflectionMap = new Map<string, string[]>()
  for (const reflection of reflections) {
    const {reflectionGroupId, id} = reflection
    const existing = groupReflectionMap.get(reflectionGroupId)
    if (existing) {
      existing.push(id)
    } else {
      groupReflectionMap.set(reflectionGroupId, [id])
    }
  }

  // For each group that has more than one reflection, remove all but the first
  // so each reflection ends up in its own group
  for (const [, reflectionIds] of groupReflectionMap) {
    if (reflectionIds.length <= 1) continue
    // Keep the first reflection in the original group, remove the rest
    const reflectionsToRemove = reflectionIds.slice(1)
    for (const reflectionId of reflectionsToRemove) {
      await removeReflectionFromGroup(reflectionId, context)
    }
  }

  const data = {meetingId}
  publish(
    SubscriptionChannel.MEETING,
    meetingId,
    'UngroupAllReflectionsSuccess',
    data,
    subOptions
  )
  return data
}

export default ungroupAllReflections
