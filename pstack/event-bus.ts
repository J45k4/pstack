export type EventMap = Record<string, unknown>
export type EventTopic<TEvents extends EventMap> = Extract<keyof TEvents, string>

export type EventBusSubscription<TEvent> = AsyncIterableIterator<TEvent> & {
	close(): void
}

type Subscriber<TEvent> = {
	queue: TEvent[]
	waiting:
		| {
				resolve: (result: IteratorResult<TEvent>) => void
				reject: (error: unknown) => void
		  }
		| undefined
	closed: boolean
}

export class EventBus<TEvents extends EventMap = EventMap> {
	private readonly subscribers = new Map<string, Set<Subscriber<unknown>>>()
	private closed = false

	publish<TTopic extends EventTopic<TEvents>>(topic: TTopic, event: TEvents[TTopic]) {
		if (this.closed) {
			throw new Error("EventBus is closed")
		}

		const subscribers = this.subscribers.get(topic)

		if (!subscribers) {
			return
		}

		for (const subscriber of subscribers) {
			this.deliver(subscriber as Subscriber<TEvents[TTopic]>, event)
		}
	}

	subscribe<TTopic extends EventTopic<TEvents>>(
		topic: TTopic,
	): EventBusSubscription<TEvents[TTopic]> {
		if (this.closed) {
			throw new Error("EventBus is closed")
		}

		const subscriber: Subscriber<TEvents[TTopic]> = {
			queue: [],
			waiting: undefined,
			closed: false,
		}
		const subscriptions = this.subscribers.get(topic) ?? new Set<Subscriber<unknown>>()

		subscriptions.add(subscriber as Subscriber<unknown>)
		this.subscribers.set(topic, subscriptions)

		const close = () => {
			if (subscriber.closed) {
				return
			}

			subscriber.closed = true
			subscriptions.delete(subscriber as Subscriber<unknown>)

			if (subscriptions.size === 0) {
				this.subscribers.delete(topic)
			}

			subscriber.waiting?.resolve({ done: true, value: undefined })
			subscriber.waiting = undefined
		}

		return {
			close,
			next: async () => {
				if (subscriber.queue.length > 0) {
					return {
						done: false,
						value: subscriber.queue.shift()!,
					}
				}

				if (subscriber.closed) {
					return {
						done: true,
						value: undefined,
					}
				}

				return await new Promise<IteratorResult<TEvents[TTopic]>>((resolve, reject) => {
					subscriber.waiting = { resolve, reject }
				})
			},
			return: async () => {
				close()

				return {
					done: true,
					value: undefined,
				}
			},
			throw: async (error) => {
				close()
				throw error
			},
			[Symbol.asyncIterator]() {
				return this
			},
		}
	}

	listenerCount<TTopic extends EventTopic<TEvents>>(topic?: TTopic) {
		if (topic) {
			return this.subscribers.get(topic)?.size ?? 0
		}

		let count = 0

		for (const subscribers of this.subscribers.values()) {
			count += subscribers.size
		}

		return count
	}

	close() {
		if (this.closed) {
			return
		}

		this.closed = true

		for (const subscribers of this.subscribers.values()) {
			for (const subscriber of subscribers) {
				subscriber.closed = true
				subscriber.waiting?.resolve({ done: true, value: undefined })
				subscriber.waiting = undefined
			}
		}

		this.subscribers.clear()
	}

	private deliver<TEvent>(subscriber: Subscriber<TEvent>, event: TEvent) {
		if (subscriber.closed) {
			return
		}

		if (subscriber.waiting) {
			subscriber.waiting.resolve({
				done: false,
				value: event,
			})
			subscriber.waiting = undefined
			return
		}

		subscriber.queue.push(event)
	}
}

export function createEventBus<TEvents extends EventMap = EventMap>() {
	return new EventBus<TEvents>()
}
