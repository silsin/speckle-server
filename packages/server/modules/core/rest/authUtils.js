'use strict'
const {
  validateScopes,
  validateServerRole,
  authorizeResolver
} = require('@/modules/shared')

const { getStream } = require('../services/streams')
const { Roles, Scopes } = require('@speckle/shared')

module.exports = {
  async validatePermissionsReadStream(streamId, req) {
    const stream = await getStream({ streamId, userId: req.context.userId })
    if (stream?.isPublic) return { result: true, status: 200 }

    try {
      await validateServerRole(req.context, Roles.Server.User)
    } catch (err) {
      return { result: false, status: 401 }
    }

    if (!stream) return { result: false, status: 404 }

    if (!stream.isPublic && req.context.auth === false) {
      return { result: false, status: 401 }
    }

    if (!stream.isPublic) {
      try {
        await validateScopes(req.context.scopes, Scopes.Streams.Read)
      } catch (err) {
        return { result: false, status: 401 }
      }

      try {
        await authorizeResolver(req.context.userId, streamId, 'stream:reviewer')
      } catch (err) {
        return { result: false, status: 401 }
      }
    }
    return { result: true, status: 200 }
  },

  async validatePermissionsWriteStream(streamId, req) {
    if (!req.context || !req.context.auth) {
      return { result: false, status: 401 }
    }

    try {
      await validateServerRole(req.context, Roles.Server.User)
    } catch (err) {
      return { result: false, status: 401 }
    }

    try {
      await validateScopes(req.context.scopes, Scopes.Streams.Write)
    } catch (err) {
      return { result: false, status: 401 }
    }

    try {
      await authorizeResolver(req.context.userId, streamId, Roles.Stream.Contributor)
    } catch (err) {
      return { result: false, status: 401 }
    }

    return { result: true, status: 200 }
  }
}
