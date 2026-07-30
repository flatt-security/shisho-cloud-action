import * as core from '@actions/core'
import assert from 'assert/strict'
import {execFile} from 'child_process'
import {DEFAULT_STS_ENDPOINT, exchangeBotToken} from './sts'

const main = async (): Promise<void> => {
  const botID = core.getInput('bot-id', {required: true})
  const expiresInMinutes = core.getInput('expires-in-minutes')
  const stsEndpoint = core.getInput('sts-endpoint')
  const exportToken = core.getBooleanInput('export-token')

  const idToken = await core.getIDToken()

  // With `export-token: true` the action performs the token exchange itself
  // and exposes the result as a masked step output; shishoctl is neither
  // required nor configured. Without it, the shishoctl sign-in below is the
  // (unchanged) behavior.
  if (exportToken) {
    let expiresInSeconds: number | undefined
    if (expiresInMinutes !== '') {
      if (!/^[1-9][0-9]*$/.test(expiresInMinutes)) {
        core.setFailed(
          `\`expires-in-minutes\` must be a positive integer (got: ${expiresInMinutes})`
        )
        return
      }
      expiresInSeconds = Number(expiresInMinutes) * 60
    }

    const result = await exchangeBotToken({
      endpoint: stsEndpoint === '' ? DEFAULT_STS_ENDPOINT : stsEndpoint,
      botID,
      idToken,
      expiresInSeconds
    })

    // Mask before exposing: the token must never appear in run logs, even if
    // a later step echoes the output.
    core.setSecret(result.accessToken)
    core.setOutput('token', result.accessToken)
    core.setOutput(
      'expires-at',
      new Date(Date.now() + result.expiresInSeconds * 1000).toISOString()
    )
    return
  }

  await new Promise<void>(resolve => {
    const command = 'shishoctl'
    const args = [
      'auth',
      'signin:bot',
      '--bot',
      botID,
      ...(expiresInMinutes ? ['--expires-in-minutes', expiresInMinutes] : []),
      ...(stsEndpoint ? ['--sts-endpoint', stsEndpoint] : [])
    ]

    const proc = execFile(command, args, error => {
      // Note: stdout and stderr are piped to the parent process
      // so we don't need to print them in the callback

      if (error) {
        // Note: ExecFileException["code"] has the wrong type
        switch (error.code as string | number | undefined) {
          case 'ENOENT': {
            core.setFailed(
              `Command \`${error.cmd}\` is not found.
              Installation instructions are available at https://shisho.dev/docs/g/getting-started/shishoctl`
            )
            return
          }
          case 'EACCES': {
            core.setFailed(
              `Command \`${error.cmd}\` is not executable. Check the permissions of the command.`
            )
            return
          }
          default: {
            core.debug(error.message)
            core.setFailed(
              `Command \`${error.cmd}\` exited with status code ${proc.exitCode}`
            )
            return
          }
        }
      }

      resolve()
    })

    assert(proc.stdout !== null, 'failed to access stdout')
    assert(proc.stderr !== null, 'failed to access stderr')
    assert(proc.stdin !== null, 'failed to access stdin')

    proc.stdout.pipe(process.stdout)
    proc.stderr.pipe(process.stderr)

    proc.stdin.end(idToken)
  })
}

// eslint-disable-next-line github/no-then
main().catch(error => {
  core.setFailed(error)
})
