import {afterEach, describe, expect, test} from '@jest/globals'
import * as http from 'http'
import {AddressInfo} from 'net'
import {exchangeBotToken} from '../src/sts'

// Each test starts a real local HTTP server standing in for the STS, so the
// full request path (body shape, content type, status handling, response
// parsing) is exercised without mocks.

interface RecordedRequest {
  method: string | undefined
  contentType: string | undefined
  body: string
}

interface StubSTS {
  endpoint: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

const startStubSTS = async (
  statusCode: number,
  responseBody: string
): Promise<StubSTS> => {
  const requests: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      requests.push({
        method: req.method,
        contentType: req.headers['content-type'],
        body
      })
      res.statusCode = statusCode
      res.setHeader('Content-Type', 'application/json')
      res.end(responseBody)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${address.port}/bots/exchange`,
    requests,
    close: async () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      )
  }
}

describe('exchangeBotToken', () => {
  let stub: StubSTS | undefined

  afterEach(async () => {
    await stub?.close()
    stub = undefined
  })

  test('exchanges an ID token for an access token', async () => {
    stub = await startStubSTS(
      200,
      JSON.stringify({access_token: 'the-token', expires_in: 21600})
    )

    const result = await exchangeBotToken({
      endpoint: stub.endpoint,
      botID: 'BT_TEST',
      idToken: 'the-id-token',
      expiresInSeconds: 21600
    })

    expect(result).toEqual({accessToken: 'the-token', expiresInSeconds: 21600})
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0].method).toBe('POST')
    expect(stub.requests[0].contentType).toBe('application/json')
    expect(JSON.parse(stub.requests[0].body)).toEqual({
      bot_id: 'BT_TEST',
      id_token: 'the-id-token',
      expires_in: 21600
    })
  })

  test('omits expires_in when no lifetime is requested', async () => {
    stub = await startStubSTS(
      200,
      JSON.stringify({access_token: 'the-token', expires_in: 1800})
    )

    await exchangeBotToken({
      endpoint: stub.endpoint,
      botID: 'BT_TEST',
      idToken: 'the-id-token'
    })

    expect(JSON.parse(stub.requests[0].body)).toEqual({
      bot_id: 'BT_TEST',
      id_token: 'the-id-token'
    })
  })

  test('surfaces the rejection message on HTTP 400', async () => {
    stub = await startStubSTS(400, JSON.stringify({message: 'bot not found'}))

    await expect(
      exchangeBotToken({
        endpoint: stub.endpoint,
        botID: 'BT_TEST',
        idToken: 'the-id-token'
      })
    ).rejects.toThrow(
      'STS rejected the bot token exchange: Invalid input: bot not found'
    )
  })

  test('falls back to a generic reason on HTTP 400 without a message', async () => {
    stub = await startStubSTS(400, 'not json')

    await expect(
      exchangeBotToken({
        endpoint: stub.endpoint,
        botID: 'BT_TEST',
        idToken: 'the-id-token'
      })
    ).rejects.toThrow(
      'STS rejected the bot token exchange: Invalid input: unknown error'
    )
  })

  test('reports other non-200 statuses without detail', async () => {
    stub = await startStubSTS(500, 'internal error')

    await expect(
      exchangeBotToken({
        endpoint: stub.endpoint,
        botID: 'BT_TEST',
        idToken: 'the-id-token'
      })
    ).rejects.toThrow(
      'an error occurred while authenticating, please try again (HTTP 500)'
    )
  })

  test('rejects a 200 response with an empty access_token', async () => {
    stub = await startStubSTS(
      200,
      JSON.stringify({access_token: '', expires_in: 1800})
    )

    await expect(
      exchangeBotToken({
        endpoint: stub.endpoint,
        botID: 'BT_TEST',
        idToken: 'the-id-token'
      })
    ).rejects.toThrow('empty access_token')
  })

  test('rejects a 200 response with an invalid expires_in', async () => {
    stub = await startStubSTS(
      200,
      JSON.stringify({access_token: 'the-token', expires_in: 'soon'})
    )

    await expect(
      exchangeBotToken({
        endpoint: stub.endpoint,
        botID: 'BT_TEST',
        idToken: 'the-id-token'
      })
    ).rejects.toThrow('invalid expires_in')
  })

  test('reports an unreachable endpoint', async () => {
    await expect(
      exchangeBotToken({
        // A closed port: nothing listens here.
        endpoint: 'http://127.0.0.1:9/bots/exchange',
        botID: 'BT_TEST',
        idToken: 'the-id-token'
      })
    ).rejects.toThrow(/could not reach the STS endpoint/)
  })
})
