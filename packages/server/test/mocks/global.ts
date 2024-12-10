import { createGlobalMock, mockRequireModule } from '@/test/mockHelper'

/**
 * Global mocks that can be re-used. Early setup ensures that mocks work.
 */

export const EmailSendingServiceMock = createGlobalMock<
  typeof import('@/modules/emails/services/sending')
>('@/modules/emails/services/sending')

export const CommentsRepositoryMock = mockRequireModule<
  typeof import('@/modules/comments/repositories/comments')
>(['@/modules/comments/repositories/comments'])

export const MultiRegionDbSelectorMock = mockRequireModule<
  typeof import('@/modules/multiregion/utils/dbSelector')
>(['@/modules/multiregion/utils/dbSelector'])

export const MultiRegionBlobStorageSelectorMock = mockRequireModule<
  typeof import('@/modules/multiregion/utils/blobStorageSelector')
>(['@/modules/multiregion/utils/blobStorageSelector'])

export const MultiRegionConfigMock = mockRequireModule<
  typeof import('@/modules/multiregion/regionConfig')
>(['@/modules/multiregion/regionConfig'])
