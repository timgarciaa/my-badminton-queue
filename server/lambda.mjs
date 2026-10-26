// Lambda function URL handler for phone check-in, storing each open check-in
// as one DynamoDB item. CORS is set on the function URL (template.yaml).
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { createApi } from './checkin.mjs'

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

const handle = createApi(db)

export async function handler(event) {
  let body
  try {
    body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : undefined
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }
  }
  const res = await handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    key: event.headers?.['x-key'],
    pin: event.headers?.['x-pin'],
    body,
  })
  return { statusCode: res.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(res.body) }
}
