import { buildTableHelper } from '@/modules/core/dbSchema'
import {
  GetServerInfo,
  UpdateServerInfo
} from '@/modules/core/domain/server/operations'
import { ServerInfo } from '@/modules/core/domain/server/types'
import { ServerConfigRecord } from '@/modules/core/helpers/types'
import {
  getFileSizeLimitMB,
  getMaximumObjectSizeMB,
  getServerMovedFrom,
  getServerMovedTo,
  getServerOrigin,
  getServerVersion
} from '@/modules/shared/helpers/envHelper'
import { Knex } from 'knex'

const ServerConfig = buildTableHelper('server_config', [
  'id',
  'name',
  'company',
  'description',
  'adminContact',
  'termsOfService',
  'canonicalUrl',
  'completed',
  'inviteOnly',
  'guestModeEnabled'
])

const tables = {
  serverConfig: (db: Knex) => db<ServerConfigRecord>(ServerConfig.name)
}

export const getServerInfoFactory =
  (deps: { db: Knex }): GetServerInfo =>
  async () => {
    const movedTo = getServerMovedTo()
    const movedFrom = getServerMovedFrom()

    // An entry should always exist from migrations
    const serverInfo: ServerInfo = {
      ...(await tables.serverConfig(deps.db).select('*').first())!,
      version: getServerVersion(),
      canonicalUrl: getServerOrigin(),
      configuration: {
        objectSizeLimitBytes: getMaximumObjectSizeMB() * 1024 * 1024,
        objectMultipartUploadSizeLimitBytes: getFileSizeLimitMB() * 1024 * 1024
      },
      ...(movedTo || movedFrom
        ? {
            migration: {
              movedFrom: movedFrom?.toString(),
              movedTo: movedTo?.toString()
            }
          }
        : {})
    }

    return serverInfo
  }

export const updateServerInfoFactory =
  (deps: { db: Knex }): UpdateServerInfo =>
  async ({
    name,
    company,
    description,
    adminContact,
    termsOfService,
    inviteOnly,
    guestModeEnabled
  }) => {
    const serverInfo = await tables.serverConfig(deps.db).select('*').first()
    if (!serverInfo) {
      await tables.serverConfig(deps.db).insert(
        {
          name,
          company,
          description,
          adminContact,
          termsOfService,
          inviteOnly,
          guestModeEnabled,
          completed: true
        },
        '*'
      )
    } else {
      await tables.serverConfig(deps.db).where({ id: 0 }).update({
        name,
        company,
        description,
        adminContact,
        termsOfService,
        inviteOnly,
        guestModeEnabled,
        completed: true
      })
    }
  }
