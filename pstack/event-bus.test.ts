import { expect, test } from "bun:test"
import { EventBus } from "./event-bus"

type Message = {
	roomId: string
	text: string
}

type Events = {
	"room:1": Message
	"room:2": Message
}

test("EventBus delivers published events to subscribers", async () => {
	const bus = new EventBus<Events>()
	const subscription = bus.subscribe("room:1")

	bus.publish("room:1", {
		roomId: "1",
		text: "hello",
	})

	await expect(subscription.next()).resolves.toEqual({
		done: false,
		value: {
			roomId: "1",
			text: "hello",
		},
	})

	subscription.close()
})

test("EventBus isolates topics", async () => {
	const bus = new EventBus<Events>()
	const subscription = bus.subscribe("room:1")

	bus.publish("room:2", {
		roomId: "2",
		text: "ignored",
	})
	bus.publish("room:1", {
		roomId: "1",
		text: "received",
	})

	await expect(subscription.next()).resolves.toEqual({
		done: false,
		value: {
			roomId: "1",
			text: "received",
		},
	})

	subscription.close()
})

test("EventBus return unsubscribes", async () => {
	const bus = new EventBus<Events>()
	const subscription = bus.subscribe("room:1")

	expect(bus.listenerCount("room:1")).toBe(1)

	await subscription.return?.()

	expect(bus.listenerCount("room:1")).toBe(0)
	await expect(subscription.next()).resolves.toEqual({
		done: true,
		value: undefined,
	})
})

test("EventBus closes active subscriptions", async () => {
	const bus = new EventBus<Events>()
	const subscription = bus.subscribe("room:1")
	const next = subscription.next()

	bus.close()

	await expect(next).resolves.toEqual({
		done: true,
		value: undefined,
	})
	expect(bus.listenerCount()).toBe(0)
	expect(() =>
		bus.publish("room:1", {
			roomId: "1",
			text: "closed",
		}),
	).toThrow("EventBus is closed")
})
