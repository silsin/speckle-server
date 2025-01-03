const { Buffer } = require('node:buffer')
const request = require('supertest')
const expect = require('chai').expect
const { beforeEachContext, getMainTestRegionKeyIfMultiRegion } = require('@/test/hooks')
const { Scopes } = require('@/modules/core/helpers/mainConstants')
const { db } = require('@/db/knex')
const {
  deleteServerOnlyInvitesFactory,
  updateAllInviteTargetsFactory
} = require('@/modules/serverinvites/repositories/serverInvites')

const {
  getUserFactory,
  storeUserFactory,
  countAdminUsersFactory,
  storeUserAclFactory
} = require('@/modules/core/repositories/users')
const {
  findEmailFactory,
  createUserEmailFactory,
  ensureNoPrimaryEmailForUserFactory
} = require('@/modules/core/repositories/userEmails')
const {
  requestNewEmailVerificationFactory
} = require('@/modules/emails/services/verification/request')
const {
  deleteOldAndInsertNewVerificationFactory
} = require('@/modules/emails/repositories')
const { renderEmail } = require('@/modules/emails/services/emailRendering')
const { sendEmail } = require('@/modules/emails/services/sending')
const { createUserFactory } = require('@/modules/core/services/users/management')
const {
  validateAndCreateUserEmailFactory
} = require('@/modules/core/services/userEmails')
const {
  finalizeInvitedServerRegistrationFactory
} = require('@/modules/serverinvites/services/processing')
const { UsersEmitter } = require('@/modules/core/events/usersEmitter')
const { createTokenFactory } = require('@/modules/core/services/tokens')
const {
  storeApiTokenFactory,
  storeTokenScopesFactory,
  storeTokenResourceAccessDefinitionsFactory
} = require('@/modules/core/repositories/tokens')
const { getServerInfoFactory } = require('@/modules/core/repositories/server')
const { createTestStream } = require('@/test/speckle-helpers/streamHelper')
const { waitForRegionUser } = require('@/test/speckle-helpers/regions')
const { createTestWorkspace } = require('@/modules/workspaces/tests/helpers/creation')
const { faker } = require('@faker-js/faker')

const getServerInfo = getServerInfoFactory({ db })

const findEmail = findEmailFactory({ db })
const requestNewEmailVerification = requestNewEmailVerificationFactory({
  findEmail,
  getUser: getUserFactory({ db }),
  getServerInfo,
  deleteOldAndInsertNewVerification: deleteOldAndInsertNewVerificationFactory({ db }),
  renderEmail,
  sendEmail
})
const createUser = createUserFactory({
  getServerInfo,
  findEmail,
  storeUser: storeUserFactory({ db }),
  countAdminUsers: countAdminUsersFactory({ db }),
  storeUserAcl: storeUserAclFactory({ db }),
  validateAndCreateUserEmail: validateAndCreateUserEmailFactory({
    createUserEmail: createUserEmailFactory({ db }),
    ensureNoPrimaryEmailForUser: ensureNoPrimaryEmailForUserFactory({ db }),
    findEmail,
    updateEmailInvites: finalizeInvitedServerRegistrationFactory({
      deleteServerOnlyInvites: deleteServerOnlyInvitesFactory({ db }),
      updateAllInviteTargets: updateAllInviteTargetsFactory({ db })
    }),
    requestNewEmailVerification
  }),
  usersEventsEmitter: UsersEmitter.emit
})
const createToken = createTokenFactory({
  storeApiToken: storeApiTokenFactory({ db }),
  storeTokenScopes: storeTokenScopesFactory({ db }),
  storeTokenResourceAccessDefinitions: storeTokenResourceAccessDefinitionsFactory({
    db
  })
})

describe('Blobs integration @blobstorage', () => {
  let app
  let token
  const user = {
    name: 'Baron Von Blubba',
    email: 'barron@bubble.bobble',
    password: 'bubblesAreMyBlobs'
  }
  const workspace = {
    name: 'Anutha Blob Test Workspace #1',
    ownerId: '',
    id: '',
    slug: ''
  }

  const createStreamForTest = async () => {
    const stream = {
      name: faker.company.name(),
      isPublic: false,
      workspaceId: workspace.id
    }
    await createTestStream(stream, user)
    return stream.id
  }

  before(async () => {
    ;({ app } = await beforeEachContext())
    user.id = await createUser(user)
    await waitForRegionUser(user.id)
    await createTestWorkspace(workspace, user, {
      regionKey: getMainTestRegionKeyIfMultiRegion()
    })
    ;({ token } = await createToken({
      userId: user.id,
      name: 'test token',
      scopes: [Scopes.Streams.Write, Scopes.Streams.Read]
    }))
  })
  it('Uploads from multipart upload', async () => {
    const streamId = await createStreamForTest()
    const response = await request(app)
      .post(`/api/stream/${streamId}/blob`)
      .set('Authorization', `Bearer ${token}`)
      .attach('blob1', require.resolve('@/readme.md'))
      .attach('blob2', require.resolve('@/package.json'))
    expect(response.status).to.equal(201)
    expect(response.body.uploadResults).to.exist
    const uploadResults = response.body.uploadResults
    expect(uploadResults).to.have.lengthOf(2)
    expect(uploadResults.map((r) => r.uploadStatus)).to.have.members([1, 1])
  })

  it('Errors for too big files, file is deleted', async () => {
    const streamId = await createStreamForTest()
    const response = await request(app)
      .post(`/api/stream/${streamId}/blob`)
      .set('Authorization', `Bearer ${token}`)
      .attach('blob1', Buffer.alloc(114_857_601, 'asdf'), 'dummy.blob')
    expect(response.body.uploadResults).to.have.lengthOf(1)
    const [uploadResult] = response.body.uploadResults
    expect(uploadResult.uploadStatus).to.equal(2)
    expect(uploadResult.uploadError).to.equal('File size limit reached')
    const blob = await request(app)
      .get(`/api/stream/${streamId}/blob/${uploadResult.blobId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(blob.status).to.equal(404)
  })

  it('Gets blob metadata', async () => {
    const streamId = await createStreamForTest()
    const response = await request(app)
      .post(`/api/stream/${streamId}/blob`)
      .set('Authorization', `Bearer ${token}`)
      .attach('blob1', Buffer.alloc(100, 'asdf'), 'dummy.blob')
    expect(response.status).to.equal(201)
    expect(response.body.uploadResults).to.have.lengthOf(1)
    const [uploadResult] = response.body.uploadResults

    const metadataResult = await request(app)
      .get(`/api/stream/${streamId}/blobs`)
      .set('Authorization', `Bearer ${token}`)
    expect(metadataResult.status).to.equal(200)
    expect(metadataResult.body.blobs).to.have.lengthOf(1)
    expect(metadataResult.body.blobs[0].id).to.equal(uploadResult.blobId)
  })

  it('Deletes blob and object metadata', async () => {
    const streamId = await createStreamForTest()
    const response = await request(app)
      .post(`/api/stream/${streamId}/blob`)
      .set('Authorization', `Bearer ${token}`)
      .attach('blob1', Buffer.alloc(100, 'asdf'), 'dummy.blob')
    expect(response.status).to.equal(201)
    expect(response.body.uploadResults).to.have.lengthOf(1)
    const [uploadResult] = response.body.uploadResults

    const deleteResult = await request(app)
      .delete(`/api/stream/${streamId}/blob/${uploadResult.blobId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(deleteResult.status).to.equal(204)
    const blob = await request(app)
      .get(`/api/stream/${streamId}/blob/${uploadResult.blobId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(blob.status).to.equal(404)

    const metadataResult = await request(app)
      .get(`/api/stream/${streamId}/blobs`)
      .set('Authorization', `Bearer ${token}`)
    expect(metadataResult.status).to.equal(200)
    expect(metadataResult.body).to.deep.equal({ blobs: [], cursor: null })
  })

  it('Gets uploaded blob data', async () => {
    const streamId = await createStreamForTest()
    const response = await request(app)
      .post(`/api/stream/${streamId}/blob`)
      .set('Authorization', `Bearer ${token}`)
      .attach('blob1', Buffer.alloc(10, 'a'), 'dummy.blob')
    expect(response.body.uploadResults).to.have.lengthOf(1)
    const [uploadResult] = response.body.uploadResults

    const blob = await request(app)
      .get(`/api/stream/${streamId}/blob/${uploadResult.blobId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(blob.status).to.equal(200)
    expect(blob.headers['content-disposition']).to.equal(
      'attachment; filename="dummy.blob"'
    )
    expect(blob.body.toString()).to.equal('a'.repeat(10))
  })

  it('Returns 400 for bad form data', async () => {
    const streamId = await createStreamForTest()
    const response = await request(app)
      .post(`/api/stream/${streamId}/blob`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-type', 'multipart/form-data; boundary=XXX')
      // sending an unfinished part
      .send('--XXX\r\nCon')

    expect(response.status).to.equal(400)
  })
})
