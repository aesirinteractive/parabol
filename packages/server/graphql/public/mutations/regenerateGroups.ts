import {SubscriptionChannel} from '../../../../client/types/constEnums'
import getKysely from '../../../postgres/getKysely'
import {getUserId, isTeamMember} from '../../../utils/authorization'
import {Logger} from '../../../utils/Logger'
import publish from '../../../utils/publish'
import standardError from '../../../utils/standardError'
import type {GQLContext} from '../../graphql'
import generateGroups from '../../mutations/helpers/generateGroups'
import type {MutationResolvers} from '../resolverTypes'

const regenerateGroups: MutationResolvers['regenerateGroups'] = async (
  _source,
  {meetingId}: {meetingId: string},
  context: GQLContext
) => {
  const pg = getKysely()
  const {authToken, dataLoader, socketId: mutatorId} = context
  const viewerId = getUserId(authToken)
  const operationId = dataLoader.share()
  const subOptions = {operationId, mutatorId}

  const meeting = await dataLoader.get('newMeetings').load(meetingId)
  if (!meeting) {
    return standardError(new Error('Meeting not found'), {userId: viewerId})
  }
  if (meeting.meetingType !== 'retrospective') {
    return standardError(new Error('Incorrect meeting type'), {userId: viewerId})
  }
  const {teamId} = meeting
  if (!isTeamMember(authToken, teamId)) {
    return standardError(new Error('Team not found'), {userId: viewerId})
  }

  // Reset to null so all clients see loading state
  await pg
    .updateTable('NewMeeting')
    .set({autogroupReflectionGroups: null})
    .where('id', '=', meetingId)
    .execute()

  const data = {meetingId}
  publish(SubscriptionChannel.MEETING, meetingId, 'GenerateGroupsSuccess', data, subOptions)

  // Fire-and-forget regeneration
  const reflections = await dataLoader.get('retroReflectionsByMeetingId').load(meetingId)
  generateGroups(reflections, teamId).catch(Logger.log)

  return data
}

export default regenerateGroups
