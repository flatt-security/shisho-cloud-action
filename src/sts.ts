import {HttpClient} from '@actions/http-client'

// The production STS bot-exchange endpoint. Overridable only via the
// `sts-endpoint` input, which takes the full exchange URL.
export const DEFAULT_STS_ENDPOINT = 'https://sts.cloud.shisho.dev/bots/exchange'

export interface ExchangeParams {
  // Full URL of the bot-exchange endpoint.
  endpoint: string
  botID: string
  // OIDC ID token minted by the CI provider for this workflow run.
  idToken: string
  // Requested token lifetime. Omitted -> the server default applies.
  expiresInSeconds?: number
}

export interface ExchangeResult {
  accessToken: string
  expiresInSeconds: number
}

// Wire shapes of POST {endpoint}: request {bot_id, id_token, expires_in?},
// 200 response {access_token, expires_in} (seconds), 400 response {message}.
interface RequestBody {
  bot_id: string
  id_token: string
  expires_in?: number
}

// exchangeBotToken swaps an OIDC ID token for a short-lived Shisho access
// token at the STS. The returned token is a bare access token: callers that
// need a product-specific wrapper (e.g. `sk_cs_` for the CI/CD sensor
// manager) prepend it themselves.
export const exchangeBotToken = async (
  params: ExchangeParams
): Promise<ExchangeResult> => {
  const body: RequestBody = {
    bot_id: params.botID,
    id_token: params.idToken
  }
  if (params.expiresInSeconds !== undefined) {
    body.expires_in = params.expiresInSeconds
  }

  const client = new HttpClient('shisho-cloud-action', [], {
    socketTimeout: 10_000,
    allowRetries: false
  })
  try {
    let status: number | undefined
    let responseText: string
    try {
      const response = await client.post(
        params.endpoint,
        JSON.stringify(body),
        {'Content-Type': 'application/json'}
      )
      status = response.message.statusCode
      responseText = await response.readBody()
    } catch (error) {
      throw new Error(
        `could not reach the STS endpoint ${params.endpoint}: ${error}`
      )
    }

    if (status !== 200) {
      if (status === 400) {
        throw new Error(
          `STS rejected the bot token exchange: Invalid input: ${parseErrorMessage(
            responseText
          )}`
        )
      }
      throw new Error(
        `an error occurred while authenticating, please try again (HTTP ${status})`
      )
    }

    return parseExchangeResult(responseText)
  } finally {
    client.dispose()
  }
}

const parseExchangeResult = (responseText: string): ExchangeResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    throw new Error('unexpected response from the STS: not JSON')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('unexpected response from the STS: not an object')
  }
  const accessToken = (parsed as {access_token?: unknown}).access_token
  const expiresIn = (parsed as {expires_in?: unknown}).expires_in
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('unexpected response from the STS: empty access_token')
  }
  if (typeof expiresIn !== 'number' || !isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('unexpected response from the STS: invalid expires_in')
  }
  return {accessToken, expiresInSeconds: expiresIn}
}

const parseErrorMessage = (responseText: string): string => {
  try {
    const parsed: unknown = JSON.parse(responseText)
    if (parsed !== null && typeof parsed === 'object') {
      const message = (parsed as {message?: unknown}).message
      if (typeof message === 'string' && message !== '') {
        return message
      }
    }
  } catch {
    // fall through to the generic reason
  }
  return 'unknown error'
}
