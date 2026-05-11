import { expect, test } from "bun:test"
import { pStack, type PStackLogEvent } from "./index"

function startTestServer(options: Record<string, any> = {}) {
	const firstPort = 43117 + Math.floor(Math.random() * 1000)
	let lastError: unknown

	for (let attempt = 0; attempt < 20; attempt += 1) {
		try {
			return pStack({
				...options,
				hostname: "127.0.0.1",
				port: firstPort + attempt,
				development: false,
				log: false,
				routes: {
					...options.routes,
					"/ping/:name": (req) => {
						return Response.json({
							message: `pong ${req.params.name}`,
						})
					},
				},
			})
		} catch (error) {
			lastError = error
		}
	}

	throw lastError
}

test("pStack starts a Bun server with routes", async () => {
	const server = startTestServer()

	try {
		const response = await fetch(new URL("/ping/test", server.url))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ message: "pong test" })
	} finally {
		server.stop(true)
	}
})

test("pStack logs completed requests", async () => {
	const events: PStackLogEvent[] = []
	const server = startTestServer({
		enableLogging: {
			level: "info",
			logger: (event: PStackLogEvent) => events.push(event),
		},
	})

	try {
		await fetch(new URL("/ping/logged", server.url))

		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			level: "info",
			type: "request",
			method: "GET",
			path: "/ping/logged",
			status: 200,
		})
	} finally {
		server.stop(true)
	}
})

test("pStack debug logging includes request starts", async () => {
	const events: PStackLogEvent[] = []
	const server = startTestServer({
		enableLogging: {
			level: "debug",
			logger: (event: PStackLogEvent) => events.push(event),
		},
	})

	try {
		await fetch(new URL("/ping/debug", server.url))

		expect(events.map((event) => event.type)).toEqual(["request:start", "request"])
	} finally {
		server.stop(true)
	}
})

test("pStack logs route errors", async () => {
	const events: PStackLogEvent[] = []
	const server = startTestServer({
		enableLogging: {
			level: "error",
			logger: (event: PStackLogEvent) => events.push(event),
		},
		error: () => new Response("boom", { status: 500 }),
		routes: {
			"/boom": () => {
				throw new Error("boom")
			},
		},
	})

	try {
		await fetch(new URL("/boom", server.url)).catch(() => undefined)

		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			level: "error",
			type: "request:error",
			method: "GET",
			path: "/boom",
		})
	} finally {
		server.stop(true)
	}
})
