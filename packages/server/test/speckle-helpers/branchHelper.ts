import { db } from '@/db/knex'
import { saveActivityFactory } from '@/modules/activitystream/repositories'
import { addBranchCreatedActivityFactory } from '@/modules/activitystream/services/branchActivity'
import {
  createBranchFactory,
  getStreamBranchByNameFactory
} from '@/modules/core/repositories/branches'
import { createBranchAndNotifyFactory } from '@/modules/core/services/branch/management'
import { getProjectDbClient } from '@/modules/multiregion/dbSelector'
import { publish } from '@/modules/shared/utils/subscriptions'
import { BasicTestUser } from '@/test/authHelper'
import { BasicTestStream } from '@/test/speckle-helpers/streamHelper'
import { omit } from 'lodash'

export type BasicTestBranch = {
  name: string
  description?: string
  /**
   * The ID of the stream. Will be filled in by createTestBranch().
   */
  streamId: string
  /**
   * The ID of the owner. Will be filled in by createTestBranch().
   */
  authorId: string

  /**
   * The ID of the branch. Will be filled in by createTestBranch().
   */
  id: string
}

export async function createTestBranch(params: {
  branch: BasicTestBranch
  stream: BasicTestStream
  owner: BasicTestUser
}) {
  const { branch, stream, owner } = params
  branch.streamId = stream.id
  branch.authorId = owner.id

  const projectDb = await getProjectDbClient({ projectId: stream.id })

  const createBranchAndNotify = createBranchAndNotifyFactory({
    getStreamBranchByName: getStreamBranchByNameFactory({ db: projectDb }),
    createBranch: createBranchFactory({ db: projectDb }),
    addBranchCreatedActivity: addBranchCreatedActivityFactory({
      saveActivity: saveActivityFactory({ db }),
      publish
    })
  })

  const id = (
    await createBranchAndNotify(
      {
        ...omit(branch, ['id']),
        description: branch.description || null
      },
      owner.id
    )
  ).id
  branch.id = id
}

export async function createTestBranches(
  branches: Array<Parameters<typeof createTestBranch>[0]>
) {
  await Promise.all(branches.map((p) => createTestBranch(p)))
}
