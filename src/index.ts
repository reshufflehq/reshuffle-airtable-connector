import { Reshuffle, EventConfiguration } from 'reshuffle-base-connector'
import { CoreConnector, CoreEventHandler } from './CoreConnector'
import Airtable from 'airtable'

const AIRTABLE_STORAGE_KEY = 'AIRTABLE_STORAGE_KEY'
const AIRTABLE_STORAGE_KEY_HANDLE_MULTI_UPDATES = 'AIRTABLE_STORAGE_KEY_HANDLE_MULTI_UPDATES'
const DEFAULT_ENDPOINT_URL = 'https://api.airtable.com'

export interface AirtableConnectorConfigOptions {
  endpointUrl?: string
  apiKey: string
  base: string
}

export interface AirtableConnectorEventOptions {
  type: AirtableEventType
  table: string
  fireWhileTyping?: boolean
}

export type AirtableBase = ReturnType<Airtable['base']>

type TableName = string
type Tables = Record<TableName, TableRecord>

export class AirtableConnector extends CoreConnector {
  private client: Airtable
  private _base: AirtableBase
  private modificationsInStore = false

  constructor(app: Reshuffle, options: AirtableConnectorConfigOptions, id?: string) {
    super(app, options, id)
    this.configOptions.endpointUrl = options.endpointUrl || DEFAULT_ENDPOINT_URL
    this.client = new Airtable({
      endpointUrl: options.endpointUrl || DEFAULT_ENDPOINT_URL,
      apiKey: options.apiKey,
    })
    this._base = this.client.base(options.base)
  }

  // Events /////////////////////////////////////////////////////////
  public on(
    options: AirtableConnectorEventOptions,
    handler: CoreEventHandler,
    eventId?: string,
  ): EventConfiguration {
    if (!['RecordAdded', 'RecordModified', 'RecordDeleted'].includes(options.type)) {
      throw new Error(`Invalid event type: ${options.type}`)
    }

    if (!eventId) {
      eventId = `AIRTABLE/${options.type}/${options.table}/${this.id}`
    }
    if (typeof options.fireWhileTyping !== 'boolean') {
      options.fireWhileTyping = false
    }
    console.log('options.fireWhileTyping: ', options.fireWhileTyping)
    
    return this.eventManager.addEvent(options, handler, eventId)
  }

  protected async onInterval(): Promise<void> {
    const [oldObjects, newObjects] = await this.store.update(AIRTABLE_STORAGE_KEY, () =>
      this.getAllBaseRecords(),
    )

    const diff = this.diffTableEntries(oldObjects, newObjects)
    const tables = this.getTables()
    const updatedModifications = await this.getModificationsToUpdate(diff.modifications)

    if (tables.size > 0) {
      for (const table of tables) {
        if (diff.additions[table]) {
          await this.eventManager.fire(
            (ec) => ec.options.type === 'RecordAdded' && ec.options.table === table,
            Object.values(diff.additions[table]),
          )
        }
        if (updatedModifications[table]) {
          await this.eventManager.fire(
            (ec) =>
              ec.options.type === 'RecordModified' &&
              ec.options.table === table &&
              !ec.options.fireWhileTyping,
            Object.values(updatedModifications[table]),
          )
        }
        if (diff.modifications[table]) {
          await this.eventManager.fire(
            (ec) =>
              ec.options.type === 'RecordModified' &&
              ec.options.table === table &&
              ec.options.fireWhileTyping,
            Object.values(diff.modifications[table]),
          )
        }
        if (diff.removals[table]) {
          await this.eventManager.fire(
            (ec) => ec.options.type === 'RecordDeleted' && ec.options.table === table,
            Object.values(diff.removals[table]),
          )
        }
      }
    }
  }
  /**
   * Since Airtable does not have webhooks the connector has to retrieve the data
   * from Airtable DB every interval of time and compare it to the previous retrieved data.
   * In addition to this, Airtable updates the DB upon every text change even when the user didn't complete typing
   * the whole text value. With this behaviour the connector will identify many "updates" in Airtable DB
   * for just one actual update activity.
   * In order to remediate this problem the following method stores the updates and will consider
   * an update only after an interval of time without a value change.
   */
  private async getModificationsToUpdate(modifications: Record<string, Record<string, any>>) {
    const modificationsToUpdate: Tables = {}
    const tables = this.getTables()

    // set store for the 1st time
    if (!this.modificationsInStore) {
      await this.store.set(AIRTABLE_STORAGE_KEY_HANDLE_MULTI_UPDATES, modifications)
      this.modificationsInStore = true
      return modificationsToUpdate
    }

    const modificationsInLastInterval = await this.store.get(
      AIRTABLE_STORAGE_KEY_HANDLE_MULTI_UPDATES,
    )
    const modificationsForNextInterval: Tables = {}

    for (const table of tables) {
      modificationsToUpdate[table] = {}
      modificationsForNextInterval[table] = {}

      if (!modificationsInLastInterval[table]) {
        modificationsInLastInterval[table] = {}
      }

      // modification from last round is completed, fire update event
      for (const id of Object.keys(modificationsInLastInterval[table])) {
        if (!modifications[table] || !modifications[table][id]) {
          modificationsToUpdate[table][id] = modificationsInLastInterval[table][id]
        }
      }

      for (const id of Object.keys(modifications[table])) {
        // new modification in store ==> postpone firing update event for next round
        if (!modificationsInLastInterval[table][id]) {
          modificationsForNextInterval[table][id] = modifications[table][id]
          continue
        }
        // modification in store and values are equal ==> fire update event and remove from store
        if (modifications[table][id] === modificationsInLastInterval[table][id]) {
          modificationsToUpdate[table][id] = modifications[table][id]
        } else {
          // modification in store and values are not equal ==> postpone firing update event for next round
          modificationsForNextInterval[table][id] = modifications[table][id]
        }
      }
    }

    // set the store values for the next run
    await this.store.set(AIRTABLE_STORAGE_KEY_HANDLE_MULTI_UPDATES, modificationsForNextInterval)
    return modificationsToUpdate
  }

  private getTables(): Set<string> {
    const tables = new Set<string>()
    const events = Object.values(this.eventManager.eventConfigurationSet)

    for (const {
      options: { table },
    } of events) {
      tables.add(table)
    }
    return tables
  }

  private diffTableEntries(oldObjects: Tables, newObjects: Tables) {
    function likelyTheSameObject(o1: any, o2: any): boolean {
      // compare the fields values
      return JSON.stringify(o1.fields) == JSON.stringify(o2.fields)
    }

    let addCount = 0
    let modifiedCount = 0
    let delCount = 0

    const additions: Tables = {}
    const modifications: Tables = {}
    const removals: Tables = {}

    for (const table in newObjects) {
      additions[table] = {}
      modifications[table] = {}
      removals[table] = {}

      if (!oldObjects || !oldObjects[table]) {
        continue
      }

      for (const id in newObjects[table]) {
        if (id in oldObjects[table]) {
          if (!likelyTheSameObject(newObjects[table][id], oldObjects[table][id])) {
            modifications[table][id] = newObjects[table][id]
            modifiedCount++
          }
        } else {
          additions[table][id] = newObjects[table][id]
          addCount++
        }
      }
      for (const id in oldObjects[table]) {
        if (!(id in newObjects[table])) {
          removals[table][id] = oldObjects[table][id]
          delCount++
        }
      }
    }

    return {
      changeCount: addCount + modifiedCount + delCount,
      additions,
      modifications,
      removals,
    }
  }

  private async getAllBaseRecords(): Promise<Tables> {
    const objects: Tables = {}
    const events = Object.values(this.eventManager.eventConfigurationSet)

    for (const {
      options: { table },
    } of events) {
      objects[table] = {}
      try {
        await this._base(table)
          .select({})
          .eachPage(function page(records, fetchNextPage) {
            // This function (`page`) will get called for each page of records.
            records.forEach(function (record) {
              objects[table][record.id] = record
            })
            fetchNextPage()
          })
      } catch (error) {
        console.log(error)
      }
    }
    return objects
  }

  base(): AirtableBase {
    return this._base
  }

  // SDK //
  sdk(): Airtable {
    this.app.getLogger().info(`Airtable - SDK Returned`)
    return this.client
  }
}

type TableRecord = Record<string, any>

export type AirtableEventType = 'RecordAdded' | 'RecordModified' | 'RecordDeleted'
