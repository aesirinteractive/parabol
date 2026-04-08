import graphql from 'babel-plugin-relay/macro'
import {commitMutation} from 'react-relay'
import type {SetMeetingSettingsMutation as TSetMeetingSettingsMutation} from '../__generated__/SetMeetingSettingsMutation.graphql'
import type {StandardMutation} from '../types/relayMutations'

graphql`
  fragment SetMeetingSettingsMutation_team on SetMeetingSettingsPayload {
    settings {
      phaseTypes
      ... on RetrospectiveMeetingSettings {
        disableAnonymity
        facilitatorOnlyComments
        videoMeetingURL
      }

    }
  }
`

const mutation = graphql`
  mutation SetMeetingSettingsMutation(
    $settingsId: ID!
    $checkinEnabled: Boolean
    $teamHealthEnabled: Boolean
    $disableAnonymity: Boolean
    $facilitatorOnlyComments: Boolean
    $videoMeetingURL: String
  ) {
    setMeetingSettings(
      settingsId: $settingsId
      checkinEnabled: $checkinEnabled
      teamHealthEnabled: $teamHealthEnabled
      disableAnonymity: $disableAnonymity
      facilitatorOnlyComments: $facilitatorOnlyComments
      videoMeetingURL: $videoMeetingURL
    ) {
      ...SetMeetingSettingsMutation_team @relay(mask: false)
    }
  }
`

type Settings = NonNullable<
  TSetMeetingSettingsMutation['response']['setMeetingSettings']['settings']
>

const SetMeetingSettingsMutation: StandardMutation<TSetMeetingSettingsMutation> = (
  atmosphere,
  variables,
  {onError, onCompleted}
) => {
  return commitMutation<TSetMeetingSettingsMutation>(atmosphere, {
    mutation,
    variables,
    onCompleted,
    onError,
    optimisticUpdater: (store) => {
      const {checkinEnabled, disableAnonymity, facilitatorOnlyComments, settingsId} = variables
      const settings = store.get<Settings>(settingsId)
      if (!settings) return

      if (checkinEnabled !== undefined) {
        const phaseTypes = settings.getValue('phaseTypes')
        if (checkinEnabled && !phaseTypes.includes('checkin')) {
          settings.setValue(['checkin', ...phaseTypes], 'phaseTypes')
        } else if (!checkinEnabled && phaseTypes.includes('checkin')) {
          settings.setValue(
            phaseTypes.filter((type) => type !== 'checkin'),
            'phaseTypes'
          )
        }
      }

      if (disableAnonymity !== undefined) {
        settings.setValue(disableAnonymity, 'disableAnonymity')
      }

      if (facilitatorOnlyComments !== undefined) {
        settings.setValue(facilitatorOnlyComments, 'facilitatorOnlyComments')
      }
    }
  })
}

export default SetMeetingSettingsMutation
