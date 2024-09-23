import { InsertableAutomationFunctionRun } from '@/modules/automate/domain/types'
import {
  AutomationFunctionRunRecord,
  AutomationRecord,
  AutomationRevisionRecord,
  AutomationRevisionWithTriggersFunctions,
  AutomationRunWithTriggersFunctionRuns,
  AutomationTokenRecord,
  AutomationTriggerDefinitionRecord,
  AutomationTriggerRecordBase,
  AutomationTriggerType,
  AutomationWithRevision,
  BaseTriggerManifest,
  RunTriggerSource
} from '@/modules/automate/helpers/types'
import {
  InsertableAutomationRevision,
  InsertableAutomationRun
} from '@/modules/automate/repositories/automations'
import { AuthCodePayload } from '@/modules/automate/services/authCode'
import { ProjectAutomationCreateInput } from '@/modules/core/graph/generated/graphql'
import { ContextResourceAccessRules } from '@/modules/core/helpers/token'
import { BranchRecord, CommitRecord } from '@/modules/core/helpers/types'
import { Nullable } from '@speckle/shared'
import { SetRequired } from 'type-fest'

export type StoreAutomation = (
  automation: AutomationRecord
) => Promise<AutomationRecord>

export type StoreAutomationToken = (
  automationToken: AutomationTokenRecord
) => Promise<AutomationTokenRecord>

export type StoreAutomationRevision = (
  revision: InsertableAutomationRevision
) => Promise<AutomationRevisionWithTriggersFunctions>

export type GetAutomations = (params: {
  automationIds: string[]
  projectId?: string
}) => Promise<AutomationRecord[]>

export type GetAutomation = (params: {
  automationId: string
  projectId?: string
}) => Promise<Nullable<AutomationRecord>>

export type UpdateAutomation = (
  automation: SetRequired<Partial<AutomationRecord>, 'id'>
) => Promise<AutomationRecord>

export type GetLatestVersionAutomationRuns = (
  params: {
    projectId: string
    modelId: string
    versionId: string
  },
  options?: Partial<{ limit: number }>
) => Promise<AutomationRunWithTriggersFunctionRuns[]>

export type GetFunctionRun = (functionRunId: string) => Promise<
  | (AutomationFunctionRunRecord & {
      automationId: string
      automationRevisionId: string
    })
  | null
>

export type UpsertAutomationFunctionRun = (
  automationFunctionRun: InsertableAutomationFunctionRun
) => Promise<void>

export type GetAutomationRunFullTriggers = (params: {
  automationRunId: string
}) => Promise<{
  [type in AutomationTriggerType]: {
    triggerType: type
    triggeringId: string
    version: CommitRecord
    model: BranchRecord
  }[]
}>

export type GetFullAutomationRevisionMetadata = (
  revisionId: string
) => Promise<AutomationWithRevision<AutomationRevisionWithTriggersFunctions> | null>

export type GetFullAutomationRunById = (
  automationRunId: string
) => Promise<AutomationRunWithTriggersFunctionRuns | null>

export type GetAutomationRevisions = (params: {
  automationRevisionIds: string[]
}) => Promise<AutomationRevisionRecord[]>

export type GetAutomationRevision = (params: {
  automationRevisionId: string
}) => Promise<Nullable<AutomationRevisionRecord>>

export type GetActiveTriggerDefinitions = <
  T extends AutomationTriggerType = AutomationTriggerType
>(
  params: AutomationTriggerRecordBase<T>
) => Promise<AutomationTriggerDefinitionRecord<T>[]>

export type GetAutomationToken = (
  automationId: string
) => Promise<AutomationTokenRecord | null>

export type UpsertAutomationRun = (
  automationRun: InsertableAutomationRun
) => Promise<void>

export type GetAutomationTriggerDefinitions = <
  T extends AutomationTriggerType = AutomationTriggerType
>(params: {
  automationId: string
  projectId?: string
  triggerType?: T
}) => Promise<Array<AutomationTriggerDefinitionRecord<T> & { automationId: string }>>

export type CreateStoredAuthCode = (
  params: Omit<AuthCodePayload, 'code'>
) => Promise<AuthCodePayload>

export type CreateAutomation = (params: {
  input: ProjectAutomationCreateInput
  projectId: string
  userId: string
  userResourceAccessRules?: ContextResourceAccessRules
}) => Promise<{ automation: AutomationRecord; token: AutomationTokenRecord }>

type KeyPair = {
  publicKey: string
  privateKey: string
}

export type GetEncryptionKeyPair = () => Promise<KeyPair>

export type GetEncryptionKeyPairFor = (publicKey: string) => Promise<KeyPair>

export type TriggerAutomationRevisionRun = <
  M extends BaseTriggerManifest = BaseTriggerManifest
>(params: {
  revisionId: string
  manifest: M
  source?: RunTriggerSource
}) => Promise<{ automationRunId: string }>
