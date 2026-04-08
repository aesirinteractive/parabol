import type {RegenerateGroupsSuccessResolvers} from '../resolverTypes'

export type RegenerateGroupsSuccessSource = {
  meetingId: string
}

const RegenerateGroupsSuccess: RegenerateGroupsSuccessResolvers = {
  meeting: async ({meetingId}, _args, {dataLoader}) => {
    const meeting = await dataLoader.get('newMeetings').loadNonNull(meetingId)
    if (meeting.meetingType !== 'retrospective') throw new Error('Not a retrospective meeting')
    return meeting
  }
}

export default RegenerateGroupsSuccess
