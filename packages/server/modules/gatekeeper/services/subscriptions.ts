import {
  GetWorkspacePlan,
  GetWorkspacePlanPrice,
  GetWorkspacePlanProductId,
  GetWorkspaceSubscription,
  GetWorkspaceSubscriptionBySubscriptionId,
  PaidWorkspacePlanStatuses,
  ReconcileSubscriptionData,
  SubscriptionData,
  SubscriptionDataInput,
  UpsertPaidWorkspacePlan,
  UpsertWorkspaceSubscription
} from '@/modules/gatekeeper/domain/billing'
import {
  WorkspacePlanMismatchError,
  WorkspacePlanNotFoundError,
  WorkspaceSubscriptionNotFoundError
} from '@/modules/gatekeeper/errors/billing'
import { CountWorkspaceRoleWithOptionalProjectRole } from '@/modules/workspaces/domain/operations'
import { throwUncoveredError, WorkspaceRoles } from '@speckle/shared'
import { cloneDeep, sum } from 'lodash'

export const handleSubscriptionUpdateFactory =
  ({
    upsertPaidWorkspacePlan,
    getWorkspacePlan,
    getWorkspaceSubscriptionBySubscriptionId,
    upsertWorkspaceSubscription
  }: {
    getWorkspacePlan: GetWorkspacePlan
    upsertPaidWorkspacePlan: UpsertPaidWorkspacePlan
    getWorkspaceSubscriptionBySubscriptionId: GetWorkspaceSubscriptionBySubscriptionId
    upsertWorkspaceSubscription: UpsertWorkspaceSubscription
  }) =>
  async ({ subscriptionData }: { subscriptionData: SubscriptionData }) => {
    // we're only handling marking the sub scheduled for cancelation right now
    const subscription = await getWorkspaceSubscriptionBySubscriptionId({
      subscriptionId: subscriptionData.subscriptionId
    })
    if (!subscription) throw new WorkspaceSubscriptionNotFoundError()

    const workspacePlan = await getWorkspacePlan({
      workspaceId: subscription.workspaceId
    })
    if (!workspacePlan) throw new WorkspacePlanNotFoundError()

    let status: PaidWorkspacePlanStatuses | undefined = undefined

    if (
      subscriptionData.status === 'active' &&
      subscriptionData.cancelAt &&
      subscriptionData.cancelAt > new Date()
    ) {
      status = 'cancelationScheduled'
    } else if (
      subscriptionData.status === 'active' &&
      subscriptionData.cancelAt === null
    ) {
      status = 'valid'
    } else if (subscriptionData.status === 'past_due') {
      status = 'paymentFailed'
    } else if (subscriptionData.status === 'canceled') {
      status = 'canceled'
    }

    if (status) {
      switch (workspacePlan.name) {
        case 'team':
        case 'pro':
        case 'business':
          break
        case 'unlimited':
        case 'academia':
          throw new WorkspacePlanMismatchError()
        default:
          throwUncoveredError(workspacePlan)
      }

      await upsertPaidWorkspacePlan({
        workspacePlan: { ...workspacePlan, status }
      })
      // if there is a status in the sub, we recognize, we need to update our state
      await upsertWorkspaceSubscription({
        workspaceSubscription: {
          ...subscription,
          updatedAt: new Date(),
          subscriptionData
        }
      })
    }
  }

export const addWorkspaceSubscriptionSeatIfNeededFactory =
  ({
    getWorkspacePlan,
    getWorkspaceSubscription,
    countWorkspaceRole,
    getWorkspacePlanProductId,
    getWorkspacePlanPrice,
    reconcileSubscriptionData
  }: {
    getWorkspacePlan: GetWorkspacePlan
    getWorkspaceSubscription: GetWorkspaceSubscription
    countWorkspaceRole: CountWorkspaceRoleWithOptionalProjectRole
    getWorkspacePlanProductId: GetWorkspacePlanProductId
    getWorkspacePlanPrice: GetWorkspacePlanPrice
    reconcileSubscriptionData: ReconcileSubscriptionData
  }) =>
  async ({ workspaceId, role }: { workspaceId: string; role: WorkspaceRoles }) => {
    const workspacePlan = await getWorkspacePlan({ workspaceId })
    if (!workspacePlan) throw new WorkspacePlanNotFoundError()
    const workspaceSubscription = await getWorkspaceSubscription({ workspaceId })
    if (!workspaceSubscription) throw new WorkspaceSubscriptionNotFoundError()

    switch (workspacePlan.name) {
      case 'team':
      case 'pro':
      case 'business':
        break
      case 'unlimited':
      case 'academia':
        throw new WorkspacePlanMismatchError()
      default:
        throwUncoveredError(workspacePlan)
    }

    let productId: string
    let priceId: string
    let roleCount: number
    switch (role) {
      case 'workspace:guest':
        roleCount = await countWorkspaceRole({ workspaceId, workspaceRole: role })
        productId = getWorkspacePlanProductId({ workspacePlan: 'guest' })
        priceId = getWorkspacePlanPrice({
          workspacePlan: 'guest',
          billingInterval: workspaceSubscription.billingInterval
        })
        break
      case 'workspace:admin':
      case 'workspace:member':
        roleCount = sum(
          await Promise.all([
            countWorkspaceRole({ workspaceId, workspaceRole: 'workspace:admin' }),
            countWorkspaceRole({ workspaceId, workspaceRole: 'workspace:member' })
          ])
        )
        productId = getWorkspacePlanProductId({ workspacePlan: workspacePlan.name })
        priceId = getWorkspacePlanPrice({
          workspacePlan: workspacePlan.name,
          billingInterval: workspaceSubscription.billingInterval
        })
        break
      default:
        throwUncoveredError(role)
    }

    const subscriptionData: SubscriptionDataInput = cloneDeep(
      workspaceSubscription.subscriptionData
    )

    const currentPlanProduct = subscriptionData.products.find(
      (product) => product.productId === productId
    )
    if (!currentPlanProduct) {
      subscriptionData.products.push({ productId, priceId, quantity: roleCount })
    } else {
      // if there is enough seats, we do not have to do anything
      if (currentPlanProduct.quantity >= roleCount) return
      currentPlanProduct.quantity = roleCount
    }
    await reconcileSubscriptionData({ subscriptionData, applyProrotation: true })
  }
