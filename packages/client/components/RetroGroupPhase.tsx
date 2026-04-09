/**
 * Renders the UI for the group phase of the retrospective meeting
 *
 */
import styled from '@emotion/styled'
import {Info as InfoIcon} from '@mui/icons-material'
import graphql from 'babel-plugin-relay/macro'
import {useState} from 'react'
import {useFragment} from 'react-relay'
import type {RetroGroupPhase_meeting$key} from '~/__generated__/RetroGroupPhase_meeting.graphql'
import useCallbackRef from '~/hooks/useCallbackRef'
import useAtmosphere from '../hooks/useAtmosphere'
import {MenuPosition} from '../hooks/useCoords'
import useMutationProps from '../hooks/useMutationProps'
import useTooltip from '../hooks/useTooltip'
import AutogroupMutation from '../mutations/AutogroupMutation'
import ResetReflectionGroupsMutation from '../mutations/ResetReflectionGroupsMutation'
import UngroupAllReflectionsMutation from '../mutations/UngroupAllReflectionsMutation'
import {Elevation} from '../styles/elevation'
import {phaseLabelLookup} from '../utils/meetings/lookups'
import GroupingKanban from './GroupingKanban'
import MeetingContent from './MeetingContent'
import MeetingHeaderAndPhase from './MeetingHeaderAndPhase'
import MeetingPhaseWrapper from './MeetingPhaseWrapper'
import MeetingTopBar from './MeetingTopBar'
import PhaseHeaderDescription from './PhaseHeaderDescription'
import PhaseHeaderTitle from './PhaseHeaderTitle'
import PhaseWrapper from './PhaseWrapper'
import FlatButton from './FlatButton'
import PrimaryButton from './PrimaryButton'
import type {RetroMeetingPhaseProps} from './RetroMeeting'
import StageTimerDisplay from './StageTimerDisplay'

const ButtonWrapper = styled('div')({
  display: 'flex',
  alignItems: 'center',
  padding: '16px 0px 8px 0px'
})

const StyledButton = styled(PrimaryButton)({
  '&:hover, &:focus': {
    boxShadow: Elevation.Z2
  }
})

const StyledUndoButton = styled(FlatButton)({
  fontWeight: 600,
  marginLeft: 8
})

const ModelSelect = styled('select')({
  marginLeft: 8,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  cursor: 'pointer'
})

interface Props extends RetroMeetingPhaseProps {
  meeting: RetroGroupPhase_meeting$key
}

const RetroGroupPhase = (props: Props) => {
  const {avatarGroup, toggleSidebar, meeting: meetingRef} = props
  const meeting = useFragment(
    graphql`
      fragment RetroGroupPhase_meeting on RetrospectiveMeeting {
        ...StageTimerControl_meeting
        ...StageTimerDisplay_meeting
        ...GroupingKanban_meeting
        id
        endedAt
        showSidebar
        localStage {
          isComplete
          phaseType
        }
        resetReflectionGroups {
          groupTitle
        }
        organization {
          useAI
        }
        availableGroupingModels {
          name
          type
        }
      }
    `,
    meetingRef
  )
  const [callbackRef, phaseRef] = useCallbackRef()
  const atmosphere = useAtmosphere()
  const {
    id: meetingId,
    endedAt,
    showSidebar,
    organization,
    resetReflectionGroups,
    localStage,
    availableGroupingModels
  } = meeting
  const {useAI} = organization
  const isGroupPhaseActive = localStage?.phaseType === 'group' && !localStage?.isComplete
  const [selectedModel, setSelectedModel] = useState(availableGroupingModels[0]?.name || '')
  const {openTooltip, closeTooltip, tooltipPortal, originRef} = useTooltip<HTMLDivElement>(
    MenuPosition.UPPER_CENTER
  )
  const {submitting, onError, onCompleted, submitMutation} = useMutationProps()

  const tooltipText = `Click to group cards by common topics using AI. Don't worry, you can undo afterwards!`

  const handleAutoGroupClick = () => {
    if (submitting) return
    submitMutation()
    AutogroupMutation(atmosphere, {meetingId, modelName: selectedModel || undefined}, {onError, onCompleted})
  }

  const handleUndoGroupClick = () => {
    if (submitting) return
    submitMutation()
    ResetReflectionGroupsMutation(atmosphere, {meetingId}, {onError, onCompleted})
  }

  const handleUngroupAllClick = () => {
    if (submitting) return
    submitMutation()
    UngroupAllReflectionsMutation(atmosphere, {meetingId}, {onError, onCompleted})
  }

  return (
    <>
      {/* select-none is for Safari. Repro: drag a card & see the whole area get highlighted */}
      <MeetingContent ref={callbackRef} className='select-none'>
        <MeetingHeaderAndPhase hideBottomBar={!!endedAt}>
          <MeetingTopBar
            avatarGroup={avatarGroup}
            isMeetingSidebarCollapsed={!showSidebar}
            toggleSidebar={toggleSidebar}
          >
            <PhaseHeaderTitle>{phaseLabelLookup.group}</PhaseHeaderTitle>
            <PhaseHeaderDescription>
              {'Drag cards to group by common topics'}
            </PhaseHeaderDescription>
            {isGroupPhaseActive && (
              <ButtonWrapper>
                {useAI && availableGroupingModels.length > 0 && (
                  <>
                    <StyledButton
                      disabled={submitting}
                      waiting={submitting}
                      onClick={handleAutoGroupClick}
                    >
                      {submitting ? 'AI thinking...' : 'Suggest Groups ✨'}
                    </StyledButton>
                    {availableGroupingModels.length > 1 && (
                      <ModelSelect
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={submitting}
                      >
                        {availableGroupingModels.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.name} ({m.type})
                          </option>
                        ))}
                      </ModelSelect>
                    )}
                    <div
                      onMouseEnter={openTooltip}
                      onMouseLeave={closeTooltip}
                      className='ml-2 h-6 w-6 cursor-pointer text-slate-600'
                      ref={originRef}
                    >
                      <InfoIcon />
                    </div>
                    {resetReflectionGroups && resetReflectionGroups.length > 0 && (
                      <StyledUndoButton onClick={handleUndoGroupClick} palette={'mid'} disabled={submitting}>
                        {'Undo AI Groups'}
                      </StyledUndoButton>
                    )}
                  </>
                )}
                <StyledUndoButton onClick={handleUngroupAllClick} palette={'mid'} disabled={submitting}>
                  {'Ungroup All'}
                </StyledUndoButton>
              </ButtonWrapper>
            )}
          </MeetingTopBar>
          <PhaseWrapper>
            <StageTimerDisplay meeting={meeting} canUndo={true} />
            <MeetingPhaseWrapper>
              <GroupingKanban meeting={meeting} phaseRef={phaseRef} />
            </MeetingPhaseWrapper>
          </PhaseWrapper>
        </MeetingHeaderAndPhase>
      </MeetingContent>
      {tooltipPortal(tooltipText)}
    </>
  )
}

export default RetroGroupPhase
