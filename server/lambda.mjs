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
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
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

// Club table items:
//   { pk: club#<id>, sk: meta, name, rev, code, approved, createdBy, createdAt }
//   { pk: club#<id>, sk: doc#<doc id>, data }
//   { pk: club#<id>, sk: member#<username>, approved, requestedAt }
//   { pk: user#<username>, sk: user, clubId }      which club someone organizes
//   { pk: code#<code>, sk: code, clubId }          join codes
//   { pk: slug#<slug>, sk: slug, clubId }          public stats page link names
const Clubs = process.env.CLUB_TABLE
const get = async (pk, sk) => (await doc.send(new GetCommand({ TableName: Clubs, Key: { pk, sk } }))).Item
const query = async (pk, prefix) => {
  const items = []
  let ExclusiveStartKey
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: Clubs,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
        ExclusiveStartKey,
      }),
    )
    items.push(...(page.Items ?? []))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}
const transact = (TransactItems) => doc.send(new TransactWriteCommand({ TransactItems }))
const conditionFailed = (e) =>
  e instanceof TransactionCanceledException && e.CancellationReasons?.some((r) => r.Code === 'ConditionalCheckFailed')

export const clubDb = {
  club: async (id) => {
    const item = await get(`club#${id}`, 'meta')
    return item ? { name: item.name, rev: item.rev, code: item.code, approved: item.approved, slug: item.slug } : null
  },
  docs: async (id) => Object.fromEntries((await query(`club#${id}`, 'doc#')).map((i) => [i.sk.slice(4), i.data])),
  save: async (id, baseRev, put, remove) => {
    const pk = `club#${id}`
    try {
      await transact([
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
        ...Object.entries(put).map(([d, data]) => ({ Put: { TableName: Clubs, Item: { pk, sk: `doc#${d}`, data } } })),
        ...remove.map((d) => ({ Delete: { TableName: Clubs, Key: { pk, sk: `doc#${d}` } } })),
      ])
      return baseRev + 1
    } catch (e) {
      if (conditionFailed(e)) return null
      throw e
    }
  },
  membership: async (username) => {
    const user = await get(`user#${username}`, 'user')
    const member = user && (await get(`club#${user.clubId}`, `member#${username}`))
    return member ? { clubId: user.clubId, approved: member.approved, requestedAt: member.requestedAt } : null
  },
  members: async (id) =>
    (await query(`club#${id}`, 'member#')).map((i) => ({
      username: i.sk.slice(7),
      approved: i.approved,
      requestedAt: i.requestedAt,
    })),
  addMember: async (id, username, approved, at) => {
    try {
      await transact([
        {
          Put: {
            TableName: Clubs,
            Item: { pk: `user#${username}`, sk: 'user', clubId: id },
            ConditionExpression: 'attribute_not_exists(#pk)',
            ExpressionAttributeNames: { '#pk': 'pk' },
          },
        },
        { Put: { TableName: Clubs, Item: { pk: `club#${id}`, sk: `member#${username}`, approved, requestedAt: at } } },
      ])
      return true
    } catch (e) {
      if (conditionFailed(e)) return false
      throw e
    }
  },
  approveMember: (id, username) =>
    doc.send(
      new UpdateCommand({
        TableName: Clubs,
        Key: { pk: `club#${id}`, sk: `member#${username}` },
        UpdateExpression: 'SET #approved = :yes',
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: { '#approved': 'approved', '#pk': 'pk' },
        ExpressionAttributeValues: { ':yes': true },
      }),
    ),
  removeMember: (id, username) =>
    transact([
      { Delete: { TableName: Clubs, Key: { pk: `club#${id}`, sk: `member#${username}` } } },
      {
        Delete: {
          TableName: Clubs,
          Key: { pk: `user#${username}`, sk: 'user' },
          ConditionExpression: '#clubId = :id',
          ExpressionAttributeNames: { '#clubId': 'clubId' },
          ExpressionAttributeValues: { ':id': id },
        },
      },
    ]),
  clubByCode: async (code) => (await get(`code#${code}`, 'code'))?.clubId ?? null,
  createClub: ({ id, name, code, createdBy, approved, now }) =>
    transact([
      {
        Put: {
          TableName: Clubs,
          Item: { pk: `club#${id}`, sk: 'meta', name, rev: 0, code, approved, createdBy, createdAt: now },
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': 'pk' },
        },
      },
      {
        Put: {
          TableName: Clubs,
          Item: { pk: `code#${code}`, sk: 'code', clubId: id },
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': 'pk' },
        },
      },
    ]),
  pendingClubs: async () => {
    let count = 0
    let ExclusiveStartKey
    do {
      const page = await doc.send(
        new ScanCommand({
          TableName: Clubs,
          FilterExpression: '#sk = :meta AND #approved = :no',
          ExpressionAttributeNames: { '#sk': 'sk', '#approved': 'approved' },
          ExpressionAttributeValues: { ':meta': 'meta', ':no': false },
          Select: 'COUNT',
          ExclusiveStartKey,
        }),
      )
      count += page.Count ?? 0
      ExclusiveStartKey = page.LastEvaluatedKey
    } while (ExclusiveStartKey)
    return count
  },
  clubBySlug: async (slug) => (await get(`slug#${slug}`, 'slug'))?.clubId ?? null,
  setSlug: async (id, slug, from) => {
    try {
      await transact([
        {
          Put: {
            TableName: Clubs,
            Item: { pk: `slug#${slug}`, sk: 'slug', clubId: id },
            ConditionExpression: 'attribute_not_exists(#pk) OR #clubId = :id',
            ExpressionAttributeNames: { '#pk': 'pk', '#clubId': 'clubId' },
            ExpressionAttributeValues: { ':id': id },
          },
        },
        {
          Update: {
            TableName: Clubs,
            Key: { pk: `club#${id}`, sk: 'meta' },
            UpdateExpression: 'SET #slug = :slug',
            ConditionExpression: 'attribute_exists(#pk)',
            ExpressionAttributeNames: { '#slug': 'slug', '#pk': 'pk' },
            ExpressionAttributeValues: { ':slug': slug },
          },
        },
        ...(from && from !== slug
          ? [
              {
                Delete: {
                  TableName: Clubs,
                  Key: { pk: `slug#${from}`, sk: 'slug' },
                  ConditionExpression: '#clubId = :id',
                  ExpressionAttributeNames: { '#clubId': 'clubId' },
                  ExpressionAttributeValues: { ':id': id },
                },
              },
            ]
          : []),
      ])
      return true
    } catch (e) {
      if (conditionFailed(e)) return false
      throw e
    }
  },
  setCode: async (id, code) => {
    try {
      await transact([
        {
          Update: {
            TableName: Clubs,
            Key: { pk: `club#${id}`, sk: 'meta' },
            UpdateExpression: 'SET #code = :code',
            ConditionExpression: 'attribute_not_exists(#code)',
            ExpressionAttributeNames: { '#code': 'code' },
            ExpressionAttributeValues: { ':code': code },
          },
        },
        {
          Put: {
            TableName: Clubs,
            Item: { pk: `code#${code}`, sk: 'code', clubId: id },
            ConditionExpression: 'attribute_not_exists(#pk)',
            ExpressionAttributeNames: { '#pk': 'pk' },
          },
        },
      ])
      return code
    } catch (e) {
      if (!conditionFailed(e)) throw e
      // Given one meanwhile.
      return (await get(`club#${id}`, 'meta')).code
    }
  },
}

// Organizer accounts in the Cognito user pool, with a permanent password (no email).
const UserPoolId = process.env.USER_POOL_ID
const cognito = new CognitoIdentityProviderClient({})
const accounts = {
  create: async (Username, Password) => {
    try {
      await cognito.send(new AdminCreateUserCommand({ UserPoolId, Username, MessageAction: 'SUPPRESS' }))
    } catch (e) {
      if (e.name === 'UsernameExistsException') return 'taken'
      throw e
    }
    try {
      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username, Password, Permanent: true }))
      return 'ok'
    } catch (e) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username }))
      if (e.name === 'InvalidPasswordException') return { error: 'Choose a different password.' }
      throw e
    }
  },
  remove: (Username) =>
    cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username })).catch((e) => {
      if (e.name !== 'UserNotFoundException') throw e
    }),
}

const handle = createApi(db)
const handleClub = createClubApi(
  clubDb,
  accounts,
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
  const res = path.startsWith('/club') || path === '/signup' || path.startsWith('/public/')
    ? await handleClub({ method, path, token: event.headers?.authorization?.replace(/^Bearer /, ''), body })
    : await handle({ method, path, key: event.headers?.['x-key'], pin: event.headers?.['x-pin'], body })
  // Public pages can be cached briefly by the browser; everything else is per organizer.
  const cache = path.startsWith('/public/') && res.status === 200 ? { 'cache-control': 'public, max-age=60' } : {}
  return { statusCode: res.status, headers: { 'content-type': 'application/json', ...cache }, body: JSON.stringify(res.body) }
}
