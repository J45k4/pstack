import type { DatabaseSchema } from "../../pstack"

export const schema = {
	todos: {
		id: {
			type: "text",
			primaryKey: true,
		},
		title: {
			type: "text",
			notNull: true,
		},
		completed: {
			type: "boolean",
			notNull: true,
			default: false,
		},
	},
} as const satisfies DatabaseSchema
