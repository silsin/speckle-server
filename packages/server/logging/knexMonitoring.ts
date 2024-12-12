import prometheusClient, { type Registry } from 'prom-client'
import { numberOfFreeConnections } from '@/modules/shared/helpers/dbHelper'
import { type Knex } from 'knex'
import { Logger } from 'pino'
import { toNDecimalPlaces } from '@/modules/core/utils/formatting'
import { omit } from 'lodash'

let metricQueryDuration: prometheusClient.Summary<string>
let metricQueryErrors: prometheusClient.Counter<string>
let metricConnectionAcquisitionDuration: prometheusClient.Histogram<string>
let metricConnectionPoolErrors: prometheusClient.Counter<string>
let metricConnectionInUseDuration: prometheusClient.Histogram<string>
let metricConnectionPoolReapingDuration: prometheusClient.Histogram<string>
const initializedRegions: string[] = []
let initializedPollingMetrics = false

export const initKnexPrometheusMetrics = async (params: {
  getAllDbClients: () => Promise<
    Array<{ client: Knex; isMain: boolean; regionKey: string }>
  >
  register: Registry
  logger: Logger
}) => {
  if (!initializedPollingMetrics) {
    initializedPollingMetrics = true
    new prometheusClient.Gauge({
      registers: [params.register],
      name: 'speckle_server_knex_free',
      labelNames: ['region'],
      help: 'Number of free DB connections',
      async collect() {
        for (const dbClient of await params.getAllDbClients()) {
          this.set(
            { region: dbClient.regionKey },
            dbClient.client.client.pool.numFree()
          )
        }
      }
    })

    new prometheusClient.Gauge({
      registers: [params.register],
      name: 'speckle_server_knex_used',
      labelNames: ['region'],
      help: 'Number of used DB connections',
      async collect() {
        for (const dbClient of await params.getAllDbClients()) {
          this.set(
            { region: dbClient.regionKey },
            dbClient.client.client.pool.numUsed()
          )
        }
      }
    })

    new prometheusClient.Gauge({
      registers: [params.register],
      name: 'speckle_server_knex_pending',
      labelNames: ['region'],
      help: 'Number of pending DB connection aquires',
      async collect() {
        for (const dbClient of await params.getAllDbClients()) {
          this.set(
            { region: dbClient.regionKey },
            dbClient.client.client.pool.numPendingAcquires()
          )
        }
      }
    })

    new prometheusClient.Gauge({
      registers: [params.register],
      name: 'speckle_server_knex_pending_creates',
      labelNames: ['region'],
      help: 'Number of pending DB connection creates',
      async collect() {
        for (const dbClient of await params.getAllDbClients()) {
          this.set(
            { region: dbClient.regionKey },
            dbClient.client.client.pool.numPendingCreates()
          )
        }
      }
    })

    new prometheusClient.Gauge({
      registers: [params.register],
      name: 'speckle_server_knex_pending_validations',
      labelNames: ['region'],
      help: 'Number of pending DB connection validations. This is a state between pending acquisition and acquiring a connection.',
      async collect() {
        for (const dbClient of await params.getAllDbClients()) {
          this.set(
            { region: dbClient.regionKey },
            dbClient.client.client.pool.numPendingValidations()
          )
        }
      }
    })

    new prometheusClient.Gauge({
      registers: [params.register],
      name: 'speckle_server_knex_remaining_capacity',
      labelNames: ['region'],
      help: 'Remaining capacity of the DB connection pool',
      async collect() {
        for (const dbClient of await params.getAllDbClients()) {
          this.set(
            { region: dbClient.regionKey },
            numberOfFreeConnections(dbClient.client)
          )
        }
      }
    })

    metricQueryDuration = new prometheusClient.Summary({
      registers: [params.register],
      labelNames: ['sqlMethod', 'sqlNumberBindings', 'region'],
      name: 'speckle_server_knex_query_duration',
      help: 'Summary of the DB query durations in seconds'
    })

    metricQueryErrors = new prometheusClient.Counter({
      registers: [params.register],
      labelNames: ['sqlMethod', 'sqlNumberBindings', 'region'],
      name: 'speckle_server_knex_query_errors',
      help: 'Number of DB queries with errors'
    })

    metricConnectionAcquisitionDuration = new prometheusClient.Histogram({
      registers: [params.register],
      name: 'speckle_server_knex_connection_acquisition_duration',
      labelNames: ['region'],
      help: 'Summary of the DB connection acquisition duration, from request to acquire connection from pool until successfully acquired, in seconds'
    })

    metricConnectionPoolErrors = new prometheusClient.Counter({
      registers: [params.register],
      name: 'speckle_server_knex_connection_acquisition_errors',
      labelNames: ['region'],
      help: 'Number of DB connection pool acquisition errors'
    })

    metricConnectionInUseDuration = new prometheusClient.Histogram({
      registers: [params.register],
      name: 'speckle_server_knex_connection_usage_duration',
      labelNames: ['region'],
      help: 'Summary of the DB connection duration, from successful acquisition of connection from pool until release back to pool, in seconds'
    })

    metricConnectionPoolReapingDuration = new prometheusClient.Histogram({
      registers: [params.register],
      name: 'speckle_server_knex_connection_pool_reaping_duration',
      labelNames: ['region'],
      help: 'Summary of the DB connection pool reaping duration, in seconds. Reaping is the process of removing idle connections from the pool.'
    })
  }

  // configure hooks on knex
  for (const dbClient of await params.getAllDbClients()) {
    if (initializedRegions.includes(dbClient.regionKey)) continue
    initKnexPrometheusMetricsForRegionEvents({
      logger: params.logger,
      region: dbClient.regionKey,
      db: dbClient.client
    })
    initializedRegions.push(dbClient.regionKey)
  }
}

const normalizeSqlMethod = (sqlMethod: string) => {
  if (!sqlMethod) return 'unknown'
  switch (sqlMethod.toLocaleLowerCase()) {
    case 'first':
      return 'select'
    default:
      return sqlMethod.toLocaleLowerCase()
  }
}

interface QueryEvent extends Knex.Sql {
  __knexUid: string
  __knexTxId: string
  __knexQueryUid: string
}

const initKnexPrometheusMetricsForRegionEvents = async (params: {
  region: string
  db: Knex
  logger: Logger
}) => {
  const { region, db } = params
  const queryStartTime: Record<string, number> = {}
  const connectionAcquisitionStartTime: Record<string, number> = {}
  const connectionInUseStartTime: Record<string, number> = {}

  db.on('query', (data: QueryEvent) => {
    const queryId = data.__knexQueryUid + ''
    queryStartTime[queryId] = performance.now()
  })

  db.on('query-response', (_response: unknown, data: QueryEvent) => {
    const queryId = data.__knexQueryUid + ''
    const durationMs = performance.now() - queryStartTime[queryId]
    const durationSec = toNDecimalPlaces(durationMs / 1000, 2)
    delete queryStartTime[queryId]
    if (!isNaN(durationSec))
      metricQueryDuration
        .labels({
          region,
          sqlMethod: normalizeSqlMethod(data.method),
          sqlNumberBindings: data.bindings?.length || -1
        })
        .observe(durationSec)
    params.logger.debug(
      {
        region,
        sql: data.sql,
        sqlMethod: normalizeSqlMethod(data.method),
        sqlQueryId: queryId,
        sqlQueryDurationMs: toNDecimalPlaces(durationMs, 0),
        sqlNumberBindings: data.bindings?.length || -1
      },
      "DB query successfully completed, for method '{sqlMethod}', after {sqlQueryDurationMs}ms"
    )
  })

  db.on('query-error', (err: unknown, data: QueryEvent) => {
    const queryId = data.__knexQueryUid + ''
    const durationMs = performance.now() - queryStartTime[queryId]
    const durationSec = toNDecimalPlaces(durationMs / 1000, 2)
    delete queryStartTime[queryId]

    if (!isNaN(durationSec))
      metricQueryDuration
        .labels({
          region,
          sqlMethod: normalizeSqlMethod(data.method),
          sqlNumberBindings: data.bindings?.length || -1
        })
        .observe(durationSec)
    metricQueryErrors.inc()
    params.logger.warn(
      {
        err: typeof err === 'object' ? omit(err, 'detail') : err,
        region,
        sql: data.sql,
        sqlMethod: normalizeSqlMethod(data.method),
        sqlQueryId: queryId,
        sqlQueryDurationMs: toNDecimalPlaces(durationMs, 0),
        sqlNumberBindings: data.bindings?.length || -1
      },
      'DB query errored for {sqlMethod} after {sqlQueryDurationMs}ms'
    )
  })

  const pool = db.client.pool

  // configure hooks on knex connection pool
  pool.on('acquireRequest', (eventId: number) => {
    connectionAcquisitionStartTime[eventId] = performance.now()
    // params.logger.debug(
    //   {
    //     eventId
    //   },
    //   'DB connection acquisition request occurred.'
    // )
  })
  pool.on('acquireSuccess', (eventId: number, resource: unknown) => {
    const now = performance.now()
    const durationMs = now - connectionAcquisitionStartTime[eventId]
    delete connectionAcquisitionStartTime[eventId]
    if (!isNaN(durationMs))
      metricConnectionAcquisitionDuration.labels({ region }).observe(durationMs)

    // successful acquisition is the start of usage, so record that start time
    let knexUid: string | undefined = undefined
    if (resource && typeof resource === 'object' && '__knexUid' in resource) {
      const _knexUid = resource['__knexUid']
      if (_knexUid && typeof _knexUid === 'string') {
        knexUid = _knexUid
        connectionInUseStartTime[knexUid] = now
      }
    }

    // params.logger.debug(
    //   {
    //     eventId,
    //     knexUid,
    //     connectionAcquisitionDurationMs: toNDecimalPlaces(durationMs, 0)
    //   },
    //   'DB connection (knexUid: {knexUid}) acquired after {connectionAcquisitionDurationMs}ms'
    // )
  })
  pool.on('acquireFail', (eventId: number, err: unknown) => {
    const now = performance.now()
    const durationMs = now - connectionAcquisitionStartTime[eventId]
    delete connectionAcquisitionStartTime[eventId]
    metricConnectionPoolErrors.inc()
    params.logger.warn(
      {
        err,
        eventId,
        connectionAcquisitionDurationMs: toNDecimalPlaces(durationMs, 0)
      },
      'DB connection acquisition failed after {connectionAcquisitionDurationMs}ms'
    )
  })

  // resource returned to pool
  pool.on('release', (resource: unknown) => {
    if (!(resource && typeof resource === 'object' && '__knexUid' in resource)) return
    const knexUid = resource['__knexUid']
    if (!knexUid || typeof knexUid !== 'string') return

    const now = performance.now()
    const durationMs = now - connectionInUseStartTime[knexUid]
    if (!isNaN(durationMs))
      metricConnectionInUseDuration.labels({ region }).observe(durationMs)
    // params.logger.debug(
    //   {
    //     knexUid,
    //     connectionInUseDurationMs: toNDecimalPlaces(durationMs, 0)
    //   },
    //   'DB connection (knexUid: {knexUid}) released after {connectionInUseDurationMs}ms'
    // )
  })

  // resource was created and added to the pool
  // pool.on('createRequest', (eventId) => {})
  // pool.on('createSuccess', (eventId, resource) => {})
  // pool.on('createFail', (eventId, err) => {})

  // resource is destroyed and evicted from pool
  // resource may or may not be invalid when destroySuccess / destroyFail is called
  // pool.on('destroyRequest', (eventId, resource) => {})
  // pool.on('destroySuccess', (eventId, resource) => {})
  // pool.on('destroyFail', (eventId, resource, err) => {})

  // when internal reaping event clock is activated / deactivated
  let reapingStartTime: number | undefined = undefined
  pool.on('startReaping', () => {
    reapingStartTime = performance.now()
  })
  pool.on('stopReaping', () => {
    if (!reapingStartTime) return
    const durationMs = performance.now() - reapingStartTime
    if (!isNaN(durationMs))
      metricConnectionPoolReapingDuration.labels({ region }).observe(durationMs)
    reapingStartTime = undefined
  })

  // pool is destroyed (after poolDestroySuccess all event handlers are also cleared)
  // pool.on('poolDestroyRequest', (eventId) => {})
  // pool.on('poolDestroySuccess', (eventId) => {})
}
