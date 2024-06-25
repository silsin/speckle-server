import { Roles } from '@/modules/core/helpers/mainConstants'
import { getStreamRoute } from '@/modules/core/helpers/routeHelper'
import { NoInviteFoundError } from '@/modules/serverinvites/errors'
import {
  isStreamInvite,
  buildUserTarget,
  ResourceTargets
} from '@/modules/serverinvites/helpers/inviteHelper'
import { addOrUpdateStreamCollaborator } from '@/modules/core/services/streams/streamAccessService'
import { addStreamInviteDeclinedActivity } from '@/modules/activitystream/services/streamActivity'
import { getFrontendOrigin } from '@/modules/shared/helpers/envHelper'
import { ServerInviteRecord } from '@/modules/serverinvites/domain/types'
import {
  DeleteInvite,
  DeleteInvitesByTarget,
  DeleteServerOnlyInvites,
  DeleteStreamInvite,
  FindInvite,
  FindServerInvite,
  FindStreamInvite,
  UpdateAllInviteTargets
} from '@/modules/serverinvites/domain/operations'
import {
  FinalizeStreamInvite,
  ResendInviteEmail
} from '@/modules/serverinvites/services/operations'

/**
 * Resolve the relative auth redirect path, after registering with an invite
 * Note: Important auth query string params like the access_code are added separately
 * in auth middlewares
 */
export const resolveAuthRedirectPath = () => (invite?: ServerInviteRecord) => {
  if (invite) {
    const { resourceId } = invite

    if (isStreamInvite(invite)) {
      // TODO: check nullability
      return `${getStreamRoute(resourceId!)}`
    }
  }

  // Fall-back to base URL (for server invites)
  return getFrontendOrigin()
}

/**
 * Validate that the new user has a valid invite for registering to the server
 */
export const validateServerInvite =
  ({ findServerInvite }: { findServerInvite: FindServerInvite }) =>
  async (email: string, token: string): Promise<ServerInviteRecord> => {
    const invite = await findServerInvite(email, token)
    if (!invite) {
      throw new NoInviteFoundError(
        token
          ? "Wrong e-mail address or invite token. Make sure you're using the same e-mail address that received the invite."
          : "Wrong e-mail address. Make sure you're using the same e-mail address that received the invite.",
        {
          info: {
            email,
            token
          }
        }
      )
    }

    return invite
  }

/**
 * Finalize server registration by deleting unnecessary invites and updating
 * the remaining ones
 */
export const finalizeInvitedServerRegistration =
  ({
    deleteServerOnlyInvites,
    updateAllInviteTargets
  }: {
    deleteServerOnlyInvites: DeleteServerOnlyInvites
    updateAllInviteTargets: UpdateAllInviteTargets
  }) =>
  async (email: string, userId: string) => {
    // Delete all server-only invites for this email
    await deleteServerOnlyInvites(email)

    // Update all remaining invites to use a userId target, not the e-mail
    // (in case the user changes his e-mail right after)
    await updateAllInviteTargets(email, buildUserTarget(userId)!)
  }

/**
 * Accept or decline a stream invite
 */
export const finalizeStreamInvite =
  ({
    findStreamInvite,
    deleteInvitesByTarget
  }: {
    findStreamInvite: FindStreamInvite
    deleteInvitesByTarget: DeleteInvitesByTarget
  }): FinalizeStreamInvite =>
  async (accept, streamId, token, userId) => {
    const invite = await findStreamInvite(streamId, {
      token,
      target: buildUserTarget(userId)
    })
    if (!invite) {
      throw new NoInviteFoundError('Attempted to finalize nonexistant stream invite', {
        info: {
          streamId,
          token,
          userId
        }
      })
    }

    // Invite found - accept or decline
    if (accept) {
      // Add access for user
      const { role = Roles.Stream.Contributor, inviterId } = invite
      // TODO: check role nullability
      await addOrUpdateStreamCollaborator(streamId, userId, role!, inviterId, null, {
        fromInvite: true
      })

      // Delete all invites to this stream
      await deleteInvitesByTarget(
        buildUserTarget(userId)!,
        ResourceTargets.Streams,
        streamId
      )
    } else {
      await addStreamInviteDeclinedActivity({
        streamId,
        inviteTargetId: userId,
        inviterId: invite.inviterId
      })
    }

    // Delete all invites to this stream
    await deleteInvitesByTarget(
      buildUserTarget(userId)!,
      ResourceTargets.Streams,
      streamId
    )
  }

/**
 * Cancel/decline a stream invite
 */
export const cancelStreamInvite =
  ({
    findStreamInvite,
    deleteStreamInvite
  }: {
    findStreamInvite: FindStreamInvite
    deleteStreamInvite: DeleteStreamInvite
  }) =>
  async (streamId: string, inviteId: string) => {
    const invite = await findStreamInvite(streamId, {
      inviteId
    })
    if (!invite) {
      throw new NoInviteFoundError('Attempted to process nonexistant stream invite', {
        info: {
          streamId,
          inviteId
        }
      })
    }
    await deleteStreamInvite(invite.id)
  }

/**
 * Re-send pending invite e-mail, without creating a new invite
 */
export const resendInvite =
  ({
    findInvite,
    resendInviteEmail
  }: {
    resendInviteEmail: ResendInviteEmail
    findInvite: FindInvite
  }) =>
  async (inviteId: string) => {
    const invite = await findInvite(inviteId)
    if (!invite) {
      throw new NoInviteFoundError('Attempted to re-send a nonexistant invite')
    }
    await resendInviteEmail(invite)
  }

/**
 * Delete pending invite
 */
export const deleteInvite =
  ({
    findInvite,
    deleteInvite
  }: {
    findInvite: FindInvite
    deleteInvite: DeleteInvite
  }) =>
  async (inviteId: string) => {
    const invite = await findInvite(inviteId)
    if (!invite) {
      throw new NoInviteFoundError('Attempted to delete a nonexistant invite')
    }

    await deleteInvite(invite.id)
  }