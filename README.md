# reshuffle-airtable-connector

[Code](https://github.com/reshufflehq/reshuffle-airtable-connector) |
[npm](https://www.npmjs.com/package/reshuffle-airtable-connector) |
[Code sample](https://github.com/reshufflehq/reshuffle/tree/master/examples/airtable)

`npm install reshuffle-airtable-connector`

### Reshuffle Airtable Connector

This package contains a [Reshuffle](https://github.com/reshufflehq/reshuffle)
connector to connect [Airtable APIs](https://airtable.com/api).

The following example exposes an endpoint to return the first page of Airtable tab 'Design projects' with view 'All projects'. After running the example go to http://localhost:8000/projects to view the results.

```js
const { HttpConnector, Reshuffle } = require('reshuffle')
const { AirtableConnector } = require('reshuffle-airtable-connector')

const app = new Reshuffle()

const airtableConnector = new AirtableConnector(app, {
  endpointUrl: 'AIRPOINT_ENDPOINT_URL', // 'https://api.airtable.com'
  apiKey: 'YOUR_API_KEY',
  base: 'YOUR_BASE'
})

const httpConnector = new HttpConnector(app)
const base = airtableConnector.base()

httpConnector.on({ method: 'GET', path: '/projects' }, async (event, app) => {
  base('Design projects').select({
    view: 'All projects'
  }).firstPage(function(err, records) {
    if (err) {
      event.res.json(err)
      return
    }
    event.res.json(records.map(record => record.get('Name')))
  })
})

app.start()
```

The official Airtable JavaScript library can be found [here]](https://github.com/Airtable/airtable.js)


### Table of Contents

[Configuration Options](#configuration)

#### Connector Events

[Listening to Airtable events](#listen)

#### Connector Actions

[Base](#base) - Retrieve a base Airtable object

[SDK](#sdk) - Retrieve a full Airtable sdk object


### <a name="configuration"></a> Configuration options

```js
const app = new Reshuffle()
const airtableConnector = new AirtableConnector(app, {
  endpointUrl: 'AIRPOINT_ENDPOINT_URL',
  apiKey: 'YOUR_API_KEY',
  base: 'YOUR_BASE'
})
```

`endpointUrl`is optional, the default is https://api.airtable.com.

Get your `apiKey` by following the steps in [this article](https://support.airtable.com/hc/en-us/articles/219046777-How-do-I-get-my-API-key-).

More details about the APIs are described in [Airtable API documentation](https://support.airtable.com/hc/en-us/articles/203313985-Public-REST-API).


### <a name="events"></a> Events

#### <a name="listen"></a> Listening to Airtable events


In order to listen to events happening in Airtable, you'll need to capture them with the connector's `on`
function, providing an `AirtableConnectorEventOptions` to it.

Events are specific to an Airtable table/tab, for example 
in order to define all three events (added, modified, deleted) on two tables you have to define six events.

```typescript
interface AirtableConnectorEventOptions {
  type: AirtableEventType // See bellow 
  table: string           // Airtable table/tab name
  fireWhileTyping?: boolean // How to manage `RecordModified` events for text fields, check the explanation below. The default value is false.
}

// Where...
type AirtableEventType =
  | 'RecordAdded'
  | 'RecordModified'
  | 'RecordDeleted'
```

\* `'RecordAdded'` - For a Grid View, when adding a new record there is no 'Create New' button that opens a dialog that enables populating and saving the record's fields. Instead Airtable stores the new record at the time you click the create the new record, at this stage all the record's fields are empty.
Due to that, a `'RecordAdded'` event for a Grid View will end up having an empty record.  

** `fireWhileTyping` -  Airtable persists every keystroke as the user is typing text. This may result in several 'RecordModified' events firing for a single field change.
When `fireWhileTyping` is false (the default value) the connector will fire an event only when the user stops typing.
When `fireWhileTyping` is true there will be number of events, similar to the way that Airtable persisted the change.


_Example:_

```typescript
airtableConnector.on({ type: 'RecordModified', table: 'Design projects' }, async (event, app) => {
  console.log('RecordModified on Design projects table event')
  console.log(event.id)
  console.log(event.fields)
})
```


### <a name="actions"></a> Actions


#### <a name="base"></a> base

Returns a base object providing an access to the Airtable APIs.
Usually you will use `base` in order to execute all the Airtable APIs.

```typescript
const base = airtableConnector.base()
```

_Example:_

```typescript
const base = airtableConnector.base()

base('Design projects').select({
    view: 'All projects'
  }).firstPage(function(err, records) {
    if (err) {
      event.res.json(err)
      return
    }
    event.res.json(records.map(record => record.get('Name')))
  })
```


#### <a name="sdk"></a> sdk

Usually `base` will be the main access to the Airtable APIs but if you need the SDK it is available by using this action.

```typescript
const sdk = airtableConnector.sdk()
```

_Example:_

```typescript
const base = airtableConnector.sdk().base('YOUR_BASE')

base('Design projects').select({
    view: 'All projects'
  }).firstPage(function(err, records) {
    if (err) {
      event.res.json(err)
      return
    }
    event.res.json(records.map(record => record.get('Name')))
  })

```
