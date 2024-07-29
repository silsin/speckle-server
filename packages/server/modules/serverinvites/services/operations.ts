import { TokenResourceIdentifier } from '@/modules/core/domain/tokens/types'
import { ServerInfo } from '@/modules/core/helpers/types'
import { UserWithOptionalRole } from '@/modules/core/repositories/users'
import { EmailTemplateParams } from '@/modules/emails/services/emailRendering'
import { CreateInviteParams } from '@/modules/serverinvites/domain/operations'
import {
  InviteResourceTarget,
  InviteResourceTargetType,
  ServerInviteRecord
} from '@/modules/serverinvites/domain/types'
import { ResolvedTargetData } from '@/modules/serverinvites/helpers/core'
import { MaybeAsync, MaybeNullOrUndefined } from '@speckle/shared'

export type InviteResult = {
  inviteId: string
  token: string
}
export type CreateAndSendInvite = (
  params: CreateInviteParams,
  inviterResourceAccessLimits: MaybeNullOrUndefined<TokenResourceIdentifier[]>
) => Promise<InviteResult>

export type FinalizeInvite = (params: {
  finalizerUserId: string
  finalizerResourceAccessLimits: MaybeNullOrUndefined<TokenResourceIdentifier[]>
  accept: boolean
  token: string
  resourceType?: InviteResourceTargetType
}) => Promise<void>

export type ResendInviteEmail = (params: { inviteId: string }) => Promise<void>

export type CollectAndValidateResourceTargets = (params: {
  input: CreateInviteParams
  inviter: UserWithOptionalRole
  inviterResourceAccessLimits: MaybeNullOrUndefined<TokenResourceIdentifier[]>
  target: ResolvedTargetData
  targetUser: MaybeNullOrUndefined<UserWithOptionalRole>
  serverInfo: ServerInfo
}) => MaybeAsync<InviteResourceTarget[]>

export type BuildInviteEmailContents = (params: {
  invite: ServerInviteRecord
  serverInfo: ServerInfo
  inviter: UserWithOptionalRole
}) => MaybeAsync<{
  emailParams: EmailTemplateParams
  subject: string
}>

export enum InviteFinalizationAction {
  ACCEPT = 'accept',
  DECLINE = 'decline',
  /**
   * Cancel differs from decline in the way that only the resource owner can cancel the invite,
   * invite target can only decline
   */
  CANCEL = 'cancel'
}

/**
 * This function should throw if there's validation issue
 */
export type ValidateResourceInviteBeforeFinalization = (params: {
  invite: ServerInviteRecord
  finalizerUserId: string
  finalizerResourceAccessLimits: MaybeNullOrUndefined<TokenResourceIdentifier[]>
  action: InviteFinalizationAction
}) => MaybeAsync<void>

/**
 * Actually handle the invite being accepted or declined. The actual invite record
 * is already deleted by this point and doesn't require handling.
 */
export type ProcessFinalizedResourceInvite = (params: {
  invite: ServerInviteRecord
  finalizerUserId: string
  action: InviteFinalizationAction.ACCEPT | InviteFinalizationAction.DECLINE
}) => MaybeAsync<void>

export type GetInvitationTargetUsers = (params: {
  invites: ServerInviteRecord[]
}) => Promise<{ [key: string]: UserWithOptionalRole }>
