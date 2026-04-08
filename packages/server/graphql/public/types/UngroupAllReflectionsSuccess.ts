import type {UngroupAllReflectionsSuccessResolvers} from '../resolverTypes'

export type UngroupAllReflectionsSuccessSource = {
  meetingId: string
}

const UngroupAllReflectionsSuccess: UngroupAllReflectionsSuccessResolvers = {
  meeting: async ({meetingId}, _args, {dataLoader}) => {
    const meeting = await dataLoader.get('newMeetings').loadNonNull(meetingId)
    if (meeting.meetingType !== 'retrospective') throw new Error('Not a retrospective meeting')
    return meeting
  }
}

export default UngroupAllReflectionsSuccess
