import { randomUUID } from 'node:crypto'

const MAX_CORRELATION_MESSAGES = 1_000
const MAX_MAILBOX_MESSAGES = 1_000
const MAX_MESSAGE_BYTES = 64 * 1024

export interface MailMessage {
  body: string
  createdAt: number
  from: string
  id: string
  replyTo: string | undefined
  sequence: number
  to: string
}

export interface MailboxEndpoint {
  receive(): readonly MailMessage[]
  send(to: string, body: string, replyTo: string | undefined): MailMessage
}

export class RunMailbox {
  private readonly active = new Set<string>()
  private readonly messages = new Map<string, MailMessage[]>()
  private readonly sent = new Map<string, MailMessage>()
  private readonly sentOrder: string[] = []
  private sequence = 0

  constructor(taskIds: readonly string[]) {
    for (const taskId of taskIds) {
      this.active.add(taskId)
      this.messages.set(taskId, [])
    }
  }

  endpoint(taskId: string): MailboxEndpoint {
    if (!this.active.has(taskId)) throw new Error(`Mailbox Task ID "${taskId}" is not active.`)
    return {
      receive: () => {
        if (!this.active.has(taskId)) throw new Error(`Mailbox Task ID "${taskId}" is not active.`)
        const mailbox = this.messages.get(taskId)
        if (mailbox === undefined) throw new Error(`Mailbox Task ID "${taskId}" does not exist.`)
        const received = mailbox.map((message) => ({ ...message }))
        mailbox.length = 0
        return received
      },
      send: (to, body, replyTo) => this.send(taskId, to, body, replyTo),
    }
  }

  close(taskId: string): void {
    if (!this.active.delete(taskId)) return
    this.messages.get(taskId)?.splice(0)
    for (const [id, message] of this.sent) {
      if (message.from === taskId || message.to === taskId) this.forget(id)
    }
  }

  private forget(id: string): void {
    this.sent.delete(id)
    const index = this.sentOrder.indexOf(id)
    if (index >= 0) this.sentOrder.splice(index, 1)
  }

  private send(from: string, to: string, body: string, replyTo: string | undefined): MailMessage {
    if (!this.active.has(from)) throw new Error(`Mailbox sender Task ID "${from}" is not active.`)
    if (from === to) throw new Error('A mailbox Task cannot send to itself.')
    if (!this.active.has(to)) throw new Error(`Mailbox target Task ID "${to}" is not active.`)
    const mailbox = this.messages.get(to)
    if (mailbox === undefined) throw new Error(`Mailbox target Task ID "${to}" does not exist.`)
    if (body.trim().length === 0) throw new Error('A mailbox message cannot be empty.')
    if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) {
      throw new Error(`A mailbox message cannot exceed ${MAX_MESSAGE_BYTES} bytes.`)
    }
    if (mailbox.length >= MAX_MAILBOX_MESSAGES) {
      throw new Error(`Mailbox target "${to}" contains too many pending messages.`)
    }
    if (replyTo !== undefined) {
      const original = this.sent.get(replyTo)
      if (original === undefined) {
        throw new Error(`Mailbox reply target "${replyTo}" does not exist in this run.`)
      }
      if (original.to !== from || original.from !== to) {
        throw new Error(`Mailbox reply target "${replyTo}" does not match this conversation.`)
      }
      this.forget(replyTo)
    }
    this.sequence += 1
    const message: MailMessage = {
      body,
      createdAt: Date.now(),
      from,
      id: randomUUID(),
      replyTo,
      sequence: this.sequence,
      to,
    }
    mailbox.push(message)
    this.sent.set(message.id, message)
    this.sentOrder.push(message.id)
    while (this.sent.size > MAX_CORRELATION_MESSAGES) {
      const oldest = this.sentOrder.shift()
      if (oldest === undefined) break
      this.sent.delete(oldest)
    }
    return { ...message }
  }
}
