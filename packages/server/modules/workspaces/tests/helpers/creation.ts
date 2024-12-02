import { db } from '@/db/knex'
import {
  findEmailsByUserIdFactory,
  findVerifiedEmailsByUserIdFactory
} from '@/modules/core/repositories/userEmails'
import {
  findUserByTargetFactory,
  insertInviteAndDeleteOldFactory
} from '@/modules/serverinvites/repositories/serverInvites'
import { createAndSendInviteFactory } from '@/modules/serverinvites/services/creation'
import { getEventBus } from '@/modules/shared/services/eventBus'
import { parseDefaultProjectRole } from '@/modules/workspaces/domain/logic'
import {
  getWorkspaceRolesFactory,
  upsertWorkspaceFactory,
  upsertWorkspaceRoleFactory,
  deleteWorkspaceRoleFactory as dbDeleteWorkspaceRoleFactory,
  getWorkspaceFactory,
  getWorkspaceWithDomainsFactory,
  getWorkspaceDomainsFactory,
  storeWorkspaceDomainFactory,
  getWorkspaceBySlugFactory
} from '@/modules/workspaces/repositories/workspaces'
import {
  buildWorkspaceInviteEmailContentsFactory,
  collectAndValidateWorkspaceTargetsFactory,
  createWorkspaceInviteFactory
} from '@/modules/workspaces/services/invites'
import {
  createWorkspaceFactory,
  updateWorkspaceRoleFactory,
  deleteWorkspaceRoleFactory,
  updateWorkspaceFactory,
  addDomainToWorkspaceFactory,
  validateSlugFactory,
  generateValidSlugFactory
} from '@/modules/workspaces/services/management'
import { BasicTestUser } from '@/test/authHelper'
import { CreateWorkspaceInviteMutationVariables } from '@/test/graphql/generated/graphql'
import cryptoRandomString from 'crypto-random-string'
import {
  MaybeNullOrUndefined,
  Roles,
  StreamRoles,
  WorkspaceRoles
} from '@speckle/shared'
import { getStreamFactory } from '@/modules/core/repositories/streams'
import { getUserFactory } from '@/modules/core/repositories/users'
import { getServerInfoFactory } from '@/modules/core/repositories/server'
import {
  associateSsoProviderWithWorkspaceFactory,
  getWorkspaceSsoProviderRecordFactory,
  storeSsoProviderRecordFactory,
  upsertUserSsoSessionFactory
} from '@/modules/workspaces/repositories/sso'
import { getEncryptor } from '@/modules/workspaces/helpers/sso'
import { OidcProvider } from '@/modules/workspaces/domain/sso/types'
import { getFeatureFlags, getFrontendOrigin } from '@/modules/shared/helpers/envHelper'
import { getDefaultSsoSessionExpirationDate } from '@/modules/workspaces/domain/sso/logic'
import {
  getWorkspacePlanFactory,
  upsertPaidWorkspacePlanFactory
} from '@/modules/gatekeeper/repositories/billing'
import { SetOptional } from 'type-fest'
import { isMultiRegionTestMode } from '@/test/speckle-helpers/regions'
import {
  assignRegionFactory,
  getAvailableRegionsFactory
} from '@/modules/workspaces/services/regions'
import { getRegionsFactory } from '@/modules/multiregion/repositories'
import { canWorkspaceUseRegionsFactory } from '@/modules/gatekeeper/services/featureAuthorization'
import {
  getDefaultRegionFactory,
  upsertRegionAssignmentFactory
} from '@/modules/workspaces/repositories/regions'
import { getDb } from '@/modules/multiregion/dbSelector'

const { FF_WORKSPACES_MODULE_ENABLED } = getFeatureFlags()

export type BasicTestWorkspace = {
  /**
   * Leave empty, will be filled on creation
   * Note: Will be set to undefined if tests running with workspaces disabled entirely cause workspaces can't be created!
   */
  id: string
  /**
   * Leave empty, will be filled on creation
   */
  ownerId: string
  /**
   * You can leave empty, will be filled on creation
   */
  slug: string
  name: string
  description?: string
  logo?: string
  defaultProjectRole?: StreamRoles
  discoverabilityEnabled?: boolean
  domainBasedMembershipProtectionEnabled?: boolean
}

export const createTestWorkspace = async (
  workspace: SetOptional<BasicTestWorkspace, 'slug'>,
  owner: BasicTestUser,
  options?: { domain?: string; addPlan?: boolean; regionKey?: string }
) => {
  const { domain, addPlan = true, regionKey } = options || {}
  const useRegion = isMultiRegionTestMode() && regionKey

  if (!FF_WORKSPACES_MODULE_ENABLED) {
    // Just skip creation and set id to undefined - this allows this to be invoked the same way if FFs are on or off
    // When BasicTestStream.workspaceId is set to this workspaces id, it will end up just being undefined, making the stream
    // be created as if it was not assigned to a workspace, allowing tests to still work
    // (Surely if you explicitly invoke createTestWorkspace with FFs off, you know what you're doing)
    workspace.id = undefined as unknown as string
    return
  }

  const upsertWorkspacePlan = upsertPaidWorkspacePlanFactory({ db })
  const createWorkspace = createWorkspaceFactory({
    validateSlug: validateSlugFactory({
      getWorkspaceBySlug: getWorkspaceBySlugFactory({ db })
    }),
    generateValidSlug: generateValidSlugFactory({
      getWorkspaceBySlug: getWorkspaceBySlugFactory({ db })
    }),
    upsertWorkspace: upsertWorkspaceFactory({ db }),
    upsertWorkspaceRole: upsertWorkspaceRoleFactory({ db }),
    emitWorkspaceEvent: (...args) => getEventBus().emit(...args)
  })

  const newWorkspace = await createWorkspace({
    userId: owner.id,
    workspaceInput: {
      name: workspace.name,
      slug: workspace.slug || cryptoRandomString({ length: 10 }),
      description: workspace.description || null,
      logo: workspace.logo || null,
      defaultLogoIndex: 0
    },
    userResourceAccessLimits: null
  })

  workspace.slug = newWorkspace.slug
  workspace.id = newWorkspace.id
  workspace.ownerId = owner.id

  if (domain) {
    await addDomainToWorkspaceFactory({
      findEmailsByUserId: findEmailsByUserIdFactory({ db }),
      storeWorkspaceDomain: storeWorkspaceDomainFactory({ db }),
      getWorkspace: getWorkspaceFactory({ db }),
      upsertWorkspace: upsertWorkspaceFactory({ db }),
      emitWorkspaceEvent: getEventBus().emit,
      getDomains: getWorkspaceDomainsFactory({ db })
    })({
      userId: owner.id,
      workspaceId: workspace.id,
      domain
    })
  }

  if (addPlan || useRegion) {
    await upsertWorkspacePlan({
      workspacePlan: {
        createdAt: new Date(),
        workspaceId: newWorkspace.id,
        name: 'business',
        status: 'valid'
      }
    })
  }

  if (useRegion) {
    const regionDb = await getDb({ regionKey })
    const assignRegion = assignRegionFactory({
      getAvailableRegions: getAvailableRegionsFactory({
        getRegions: getRegionsFactory({ db }),
        canWorkspaceUseRegions: canWorkspaceUseRegionsFactory({
          getWorkspacePlan: getWorkspacePlanFactory({ db })
        })
      }),
      upsertRegionAssignment: upsertRegionAssignmentFactory({ db }),
      getDefaultRegion: getDefaultRegionFactory({ db }),
      getWorkspace: getWorkspaceFactory({ db }),
      insertRegionWorkspace: upsertWorkspaceFactory({ db: regionDb })
    })
    await assignRegion({
      workspaceId: newWorkspace.id,
      regionKey
    })
  }

  const updateWorkspace = updateWorkspaceFactory({
    validateSlug: validateSlugFactory({
      getWorkspaceBySlug: getWorkspaceBySlugFactory({ db })
    }),
    getWorkspace: getWorkspaceWithDomainsFactory({ db }),
    upsertWorkspace: upsertWorkspaceFactory({ db }),
    emitWorkspaceEvent: (...args) => getEventBus().emit(...args)
  })

  if (workspace.discoverabilityEnabled) {
    if (!domain) throw new Error('Domain is needed for discoverability')

    await updateWorkspace({
      workspaceId: newWorkspace.id,
      workspaceInput: {
        discoverabilityEnabled: true
      }
    })
  }

  if (workspace.domainBasedMembershipProtectionEnabled) {
    if (!domain) throw new Error('Domain is needed for membership protection')
    await updateWorkspace({
      workspaceId: newWorkspace.id,
      workspaceInput: { domainBasedMembershipProtectionEnabled: true }
    })
  }

  if (workspace.defaultProjectRole) {
    await updateWorkspace({
      workspaceId: newWorkspace.id,
      workspaceInput: {
        defaultProjectRole: parseDefaultProjectRole(workspace.defaultProjectRole)
      }
    })
  }
}

export const assignToWorkspace = async (
  workspace: BasicTestWorkspace,
  user: BasicTestUser,
  role?: WorkspaceRoles
) => {
  const updateWorkspaceRole = updateWorkspaceRoleFactory({
    getWorkspaceWithDomains: getWorkspaceWithDomainsFactory({ db }),
    findVerifiedEmailsByUserId: findVerifiedEmailsByUserIdFactory({ db }),
    getWorkspaceRoles: getWorkspaceRolesFactory({ db }),
    upsertWorkspaceRole: upsertWorkspaceRoleFactory({ db }),
    emitWorkspaceEvent: (...args) => getEventBus().emit(...args)
  })

  await updateWorkspaceRole({
    userId: user.id,
    workspaceId: workspace.id,
    role: role || Roles.Workspace.Member
  })
}

export const unassignFromWorkspace = async (
  workspace: BasicTestWorkspace,
  user: BasicTestUser
) => {
  const deleteWorkspaceRole = deleteWorkspaceRoleFactory({
    getWorkspaceRoles: getWorkspaceRolesFactory({ db }),
    deleteWorkspaceRole: dbDeleteWorkspaceRoleFactory({ db }),
    emitWorkspaceEvent: (...args) => getEventBus().emit(...args)
  })

  await deleteWorkspaceRole({
    userId: user.id,
    workspaceId: workspace.id
  })
}

export const unassignFromWorkspaces = async (
  pairs: [BasicTestWorkspace, BasicTestUser][]
) => {
  await Promise.all(pairs.map((p) => unassignFromWorkspace(p[0], p[1])))
}

export const assignToWorkspaces = async (
  pairs: [BasicTestWorkspace, BasicTestUser, MaybeNullOrUndefined<WorkspaceRoles>][]
) => {
  await Promise.all(pairs.map((p) => assignToWorkspace(p[0], p[1], p[2] || undefined)))
}

export const createTestWorkspaces = async (
  pairs: Parameters<typeof createTestWorkspace>[]
) => {
  await Promise.all(pairs.map((p) => createTestWorkspace(...p)))
}

export const createWorkspaceInviteDirectly = async (
  args: CreateWorkspaceInviteMutationVariables,
  inviterId: string
) => {
  const getServerInfo = getServerInfoFactory({ db })
  const getStream = getStreamFactory({ db })
  const getUser = getUserFactory({ db })
  const createAndSendInvite = createAndSendInviteFactory({
    findUserByTarget: findUserByTargetFactory({ db }),
    insertInviteAndDeleteOld: insertInviteAndDeleteOldFactory({ db }),
    collectAndValidateResourceTargets: collectAndValidateWorkspaceTargetsFactory({
      getStream,
      getWorkspace: getWorkspaceFactory({ db }),
      getWorkspaceDomains: getWorkspaceDomainsFactory({ db }),
      findVerifiedEmailsByUserId: findVerifiedEmailsByUserIdFactory({ db })
    }),
    buildInviteEmailContents: buildWorkspaceInviteEmailContentsFactory({
      getStream,
      getWorkspace: getWorkspaceFactory({ db })
    }),
    emitEvent: ({ eventName, payload }) =>
      getEventBus().emit({
        eventName,
        payload
      }),
    getUser,
    getServerInfo
  })

  const createInvite = createWorkspaceInviteFactory({
    createAndSendInvite
  })

  return await createInvite({
    ...args,
    inviterId,
    inviterResourceAccessRules: null
  })
}

export const createTestOidcProvider = async (
  workspaceId: string,
  providerData: Partial<OidcProvider> = {}
) => {
  const providerId = cryptoRandomString({ length: 9 })
  await storeSsoProviderRecordFactory({ db, encrypt: getEncryptor() })({
    providerRecord: {
      id: providerId,
      createdAt: new Date(),
      updatedAt: new Date(),
      providerType: 'oidc',
      provider: {
        providerName: 'Test Provider',
        clientId: 'test-provider',
        clientSecret: cryptoRandomString({ length: 12 }),
        issuerUrl: new URL('', getFrontendOrigin()).toString(),
        ...providerData
      }
    }
  })
  await associateSsoProviderWithWorkspaceFactory({ db })({
    workspaceId,
    providerId
  })
  return providerId
}

export const createTestSsoSession = async (
  userId: string,
  workspaceId: string,
  validUntil?: Date
) => {
  const { providerId } =
    (await getWorkspaceSsoProviderRecordFactory({ db })({ workspaceId })) ?? {}
  if (!providerId) throw new Error('No provider found')
  await upsertUserSsoSessionFactory({ db })({
    userSsoSession: {
      userId,
      providerId,
      createdAt: new Date(),
      validUntil: validUntil ?? getDefaultSsoSessionExpirationDate()
    }
  })
}
