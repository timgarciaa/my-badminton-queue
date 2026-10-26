// Lambda function URL handler for phone check-in (/s/..., one DynamoDB item per
// open check-in) and club data (/club..., one item per document, in the club
// table). CORS is set on the function URL (template.yaml).
import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { cognitoVerifier } from './auth.mjs'
import { createApi } from './checkin.mjs'
import { createClubApi } from './club.mjs'

const TableName = process.env.TABLE
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const db = {
  get: async (code) => (await doc.send(new GetCommand({ TableName, Key: { code } }))).Item,
  put: (item) => doc.send(new PutCommand({ TableName, Item: item })),
  checkIn: async (code, id, entry, now) => {
    try {
      await doc.send(
        new UpdateCommand({
          TableName,
          Key: { code },
          UpdateExpression: 'SET checkins.#id = :entry',
          // Names aliased: some words (like date) are reserved in expressions.
          ConditionExpression: 'attribute_exists(#code) AND #expires > :now AND attribute_not_exists(checkins.#id)',
          ExpressionAttributeNames: { '#code': 'code', '#expires': 'expires', '#id': id },
          ExpressionAttributeValues: { ':entry': entry, ':now': Math.floor(now / 1000) },
        }),
      )
      return true
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false
      throw e
    }
  },
  fail: (code) =>
    doc.send(
      new UpdateCommand({
        TableName,
        Key: { code },
        UpdateExpression: 'ADD #fails :one',
        ConditionExpression: 'attribute_exists(#code)',
        ExpressionAttributeNames: { '#code': 'code', '#fails': 'fails' },
        ExpressionAttributeValues: { ':one': 1 },
      }),
    ).catch((e) => {
      if (!(e instanceof ConditionalCheckFailedException)) throw e
    }),
  remove: (code) => doc.send(new DeleteCommand({ TableName, Key: { code } })),
}

// Club items: { pk: club#<id>, sk: meta, name, rev } and { pk, sk: doc#<doc id>, data }.
const Clubs = process.env.CLUB_TABLE
const clubDb = {
  load: async (clubId) => {
    const pk = `club#${clubId}`
    let club = null
    const docs = {}
    let ExclusiveStartKey
    do {
      const page = await doc.send(
        new QueryCommand({
          TableName: Clubs,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey,
        }),
      )
      for (const item of page.Items ?? []) {
        if (item.sk === 'meta') club = { name: item.name, rev: item.rev }
        else docs[item.sk.slice(4)] = item.data
      }
      ExclusiveStartKey = page.LastEvaluatedKey
    } while (ExclusiveStartKey)
    return club && { ...club, docs }
  },
  save: async (clubId, baseRev, put, remove) => {
    const pk = `club#${clubId}`
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: Clubs,
                Key: { pk, sk: 'meta' },
                UpdateExpression: 'SET #rev = #rev + :one',
                ConditionExpression: '#rev = :base',
                ExpressionAttributeNames: { '#rev': 'rev' },
                ExpressionAttributeValues: { ':one': 1, ':base': baseRev },
              },
            },
            ...Object.entries(put).map(([id, data]) => ({ Put: { TableName: Clubs, Item: { pk, sk: `doc#${id}`, data } } })),
            ...remove.map((id) => ({ Delete: { TableName: Clubs, Key: { pk, sk: `doc#${id}` } } })),
          ],
        }),
      )
      return baseRev + 1
    } catch (e) {
      if (e instanceof TransactionCanceledException && e.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') return null
      throw e
    }
  },
}

const handle = createApi(db)
const handleClub = createClubApi(
  clubDb,
  cognitoVerifier({ region: process.env.AWS_REGION, poolId: process.env.USER_POOL_ID, clientId: process.env.CLIENT_ID }),
)

export async function handler(event) {
  let body
  try {
    body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : undefined
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }
  }
  const method = event.requestContext.http.method
  const path = event.rawPath
  const res = path.startsWith('/club')
    ? await handleClub({ method, path, token: event.headers?.authorization?.replace(/^Bearer /, ''), body })
    : await handle({ method, path, key: event.headers?.['x-key'], pin: event.headers?.['x-pin'], body })
  return { statusCode: res.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(res.body) }
}
