import graphql from 'babel-plugin-relay/macro'
import {commitMutation} from 'react-relay'
import type {UngroupAllReflectionsMutation as TUngroupAllReflectionsMutation} from '../__generated__/UngroupAllReflectionsMutation.graphql'
import type {StandardMutation} from '../types/relayMutations'

graphql`
  fragment UngroupAllReflectionsMutation_meeting on UngroupAllReflectionsSuccess {
    meeting {
      id
      ... on RetrospectiveMeeting {
        resetReflectionGroups {
          groupTitle
        }
      }
      reflectionGroups {
        id
        title
        reflections {
          id
          plaintextContent
          reflectionGroupId
        }
      }
    }
  }
`

const mutation = graphql`
  mutation UngroupAllReflectionsMutation($meetingId: ID!) {
    ungroupAllReflections(meetingId: $meetingId) {
      ... on ErrorPayload {
        error {
          message
        }
      }
      ...UngroupAllReflectionsMutation_meeting @relay(mask: false)
    }
  }
`

const UngroupAllReflectionsMutation: StandardMutation<TUngroupAllReflectionsMutation> = (
  atmosphere,
  variables,
  {onError, onCompleted}
) => {
  return commitMutation<TUngroupAllReflectionsMutation>(atmosphere, {
    mutation,
    variables,
    onCompleted,
    onError
  })
}

export default UngroupAllReflectionsMutation
