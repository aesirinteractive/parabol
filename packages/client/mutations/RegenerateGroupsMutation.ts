import graphql from 'babel-plugin-relay/macro'
import {commitMutation} from 'react-relay'
import type {RegenerateGroupsMutation as TRegenerateGroupsMutation} from '../__generated__/RegenerateGroupsMutation.graphql'
import type {StandardMutation} from '../types/relayMutations'

const mutation = graphql`
  mutation RegenerateGroupsMutation($meetingId: ID!) {
    regenerateGroups(meetingId: $meetingId) {
      ... on ErrorPayload {
        error {
          message
        }
      }
      ... on RegenerateGroupsSuccess {
        meeting {
          id
          autogroupReflectionGroups {
            groupTitle
          }
        }
      }
    }
  }
`

const RegenerateGroupsMutation: StandardMutation<TRegenerateGroupsMutation> = (
  atmosphere,
  variables,
  {onError, onCompleted}
) => {
  return commitMutation<TRegenerateGroupsMutation>(atmosphere, {
    mutation,
    variables,
    optimisticUpdater: (store) => {
      const {meetingId} = variables
      const meeting = store.get(meetingId)
      if (!meeting) return
      meeting.setValue(null, 'autogroupReflectionGroups')
    },
    onCompleted,
    onError
  })
}

export default RegenerateGroupsMutation
