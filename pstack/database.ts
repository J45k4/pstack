import { SQL } from "bun"

export type DatabaseDialect = "postgres" | "mysql" | "sqlite"
export type DatabaseValue = string | number | boolean | bigint | null | Uint8Array | Date

export type DatabaseRow = Record<string, unknown>
export type Where = Record<string, DatabaseValue | readonly DatabaseValue[]>
export type ColumnType =
	| "text"
	| "integer"
	| "real"
	| "boolean"
	| "blob"
	| "json"
	| "timestamp"
	| (string & {})

export type ColumnDefault =
	| DatabaseValue
	| {
			sql: string
	  }

export type ColumnReference =
	| string
	| {
			table: string
			column: string
			onDelete?: "cascade" | "restrict" | "set null" | "no action"
			onUpdate?: "cascade" | "restrict" | "set null" | "no action"
	  }

export type ColumnDefinition =
	| string
	| {
			type: ColumnType
			primaryKey?: boolean
			autoIncrement?: boolean
			notNull?: boolean
			unique?: boolean
			default?: ColumnDefault
			references?: ColumnReference
	  }

export type TableSchema = Record<string, ColumnDefinition>
export type DatabaseSchema = Record<string, TableSchema>

export type OrderBy =
	| string
	| {
			column: string
			direction?: "asc" | "desc"
	  }

export type FindOptions = {
	select?: readonly string[]
	orderBy?: OrderBy | readonly OrderBy[]
	limit?: number
	offset?: number
}

export type Returning = "*" | readonly string[]

export type WriteOptions = {
	returning?: Returning
}

export type DatabaseOptions = {
	dialect?: DatabaseDialect
}

type SQLInput = string | URL | ConstructorParameters<typeof SQL>[0] | SQL

const sqlOptionKeys = new Set([
	"adapter",
	"url",
	"filename",
	"hostname",
	"port",
	"database",
	"username",
	"password",
])

function isSQL(value: unknown): value is SQL {
	return typeof value === "function" && "unsafe" in value && "begin" in value
}

function isSchema(value: unknown): value is DatabaseSchema {
	if (!value || typeof value !== "object" || value instanceof URL || isSQL(value)) {
		return false
	}

	return !Object.keys(value).some((key) => sqlOptionKeys.has(key))
}

function dialectFromInput(input: SQLInput | undefined): DatabaseDialect {
	if (typeof input === "string") {
		if (input.startsWith("mysql://") || input.startsWith("mysql2://")) {
			return "mysql"
		}

		if (input === ":memory:" || input.startsWith("sqlite:") || input.startsWith("file:")) {
			return "sqlite"
		}
	}

	if (input instanceof URL) {
		if (input.protocol === "mysql:" || input.protocol === "mysql2:") {
			return "mysql"
		}

		if (input.protocol === "sqlite:" || input.protocol === "file:") {
			return "sqlite"
		}
	}

	if (typeof input === "object" && input !== null && "adapter" in input) {
		const adapter = input.adapter

		if (adapter === "mysql" || adapter === "mariadb") {
			return "mysql"
		}

		if (adapter === "sqlite") {
			return "sqlite"
		}
	}

	return "postgres"
}

function assertIdentifier(identifier: string) {
	const parts = identifier.split(".")

	if (parts.length === 0 || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) {
		throw new Error(`Invalid SQL identifier: ${identifier}`)
	}
}

function placeholder(index: number, dialect: DatabaseDialect) {
	return dialect === "sqlite" ? "?" : `$${index}`
}

function normalizeLimit(name: string, value: number | undefined) {
	if (value === undefined) {
		return undefined
	}

	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer`)
	}

	return value
}

export class Database {
	readonly sql: SQL
	readonly dialect: DatabaseDialect
	readonly schema: DatabaseSchema | undefined

	constructor(input?: SQLInput, options?: DatabaseOptions)
	constructor(schema: DatabaseSchema, input?: SQLInput, options?: DatabaseOptions)
	constructor(
		inputOrSchema?: SQLInput | DatabaseSchema,
		inputOrOptions?: SQLInput | DatabaseOptions,
		options: DatabaseOptions = {},
	) {
		const hasSchema = isSchema(inputOrSchema)
		const input = hasSchema
			? (inputOrOptions as SQLInput | undefined)
			: (inputOrSchema as SQLInput | undefined)
		const databaseOptions = hasSchema
			? options
			: ((inputOrOptions as DatabaseOptions | undefined) ?? {})

		this.schema = hasSchema ? inputOrSchema : undefined
		this.sql = isSQL(input) ? input : new SQL(input as ConstructorParameters<typeof SQL>[0])
		this.dialect = databaseOptions.dialect ?? dialectFromInput(input)
	}

	static sqlite(filename = ":memory:", options?: DatabaseOptions) {
		return new Database(filename, {
			dialect: "sqlite",
			...options,
		})
	}

	static postgres(connectionString?: string | URL, options?: DatabaseOptions) {
		return new Database(connectionString, {
			dialect: "postgres",
			...options,
		})
	}

	static mysql(connectionString: string | URL, options?: DatabaseOptions) {
		return new Database(connectionString, {
			dialect: "mysql",
			...options,
		})
	}

	identifier(identifier: string) {
		assertIdentifier(identifier)

		const quote = this.dialect === "mysql" ? "`" : `"`

		return identifier
			.split(".")
			.map((part) => `${quote}${part}${quote}`)
			.join(".")
	}

	async connect() {
		await this.sql.connect()
		return this
	}

	async syncSchema(schema = this.schema) {
		if (!schema) {
			throw new Error("No database schema was provided")
		}

		for (const statement of this.schemaSql(schema)) {
			await this.execute(statement)
		}

		return this
	}

	schemaSql(schema = this.schema) {
		if (!schema) {
			throw new Error("No database schema was provided")
		}

		return Object.entries(schema).map(([table, columns]) => this.createTableSql(table, columns))
	}

	close(options?: { timeout?: number }) {
		return this.sql.close(options)
	}

	query<T extends DatabaseRow = DatabaseRow>(sql: string, values: unknown[] = []) {
		return this.sql.unsafe<T[]>(sql, values)
	}

	execute<T = unknown>(sql: string, values: unknown[] = []) {
		return this.sql.unsafe<T>(sql, values)
	}

	findMany<T extends DatabaseRow = DatabaseRow>(
		table: string,
		where: Where = {},
		options: FindOptions = {},
	) {
		const values: unknown[] = []
		const query = [
			"select",
			this.selectClause(options.select),
			"from",
			this.identifier(table),
			this.whereClause(where, values),
			this.orderByClause(options.orderBy),
			this.limitClause(options.limit, options.offset, values),
		]
			.filter(Boolean)
			.join(" ")

		return this.query<T>(query, values)
	}

	async findOne<T extends DatabaseRow = DatabaseRow>(
		table: string,
		where: Where = {},
		options: Omit<FindOptions, "limit"> = {},
	) {
		const rows = await this.findMany<T>(table, where, {
			...options,
			limit: 1,
		})

		return rows[0]
	}

	async insert<T extends DatabaseRow = DatabaseRow>(
		table: string,
		values: DatabaseRow,
		options: WriteOptions = {},
	) {
		const rows = await this.insertMany<T>(table, [values], options)
		return rows[0]
	}

	insertMany<T extends DatabaseRow = DatabaseRow>(
		table: string,
		rows: readonly DatabaseRow[],
		options: WriteOptions = {},
	) {
		if (rows.length === 0) {
			throw new Error("insertMany requires at least one row")
		}

		const columns = Object.keys(rows[0]!)

		if (columns.length === 0) {
			throw new Error("insert requires at least one column")
		}

		for (const row of rows) {
			const rowColumns = Object.keys(row)

			if (
				rowColumns.length !== columns.length ||
				rowColumns.some((column) => !columns.includes(column))
			) {
				throw new Error("insertMany rows must have the same columns")
			}
		}

		const bindings: unknown[] = []
		const valueGroups = rows.map((row) => {
			const placeholders = columns.map((column) => {
				bindings.push(row[column])
				return placeholder(bindings.length, this.dialect)
			})

			return `(${placeholders.join(", ")})`
		})
		const sql = [
			"insert into",
			this.identifier(table),
			`(${columns.map((column) => this.identifier(column)).join(", ")})`,
			"values",
			valueGroups.join(", "),
			this.returningClause(options.returning),
		]
			.filter(Boolean)
			.join(" ")

		return this.query<T>(sql, bindings)
	}

	update<T extends DatabaseRow = DatabaseRow>(
		table: string,
		values: DatabaseRow,
		where: Where,
		options: WriteOptions = {},
	) {
		const columns = Object.keys(values)

		if (columns.length === 0) {
			throw new Error("update requires at least one column")
		}

		const bindings: unknown[] = []
		const set = columns
			.map((column) => {
				bindings.push(values[column])
				return `${this.identifier(column)} = ${placeholder(bindings.length, this.dialect)}`
			})
			.join(", ")
		const sql = [
			"update",
			this.identifier(table),
			"set",
			set,
			this.whereClause(where, bindings),
			this.returningClause(options.returning),
		]
			.filter(Boolean)
			.join(" ")

		return this.query<T>(sql, bindings)
	}

	delete<T extends DatabaseRow = DatabaseRow>(
		table: string,
		where: Where,
		options: WriteOptions = {},
	) {
		const bindings: unknown[] = []
		const sql = [
			"delete from",
			this.identifier(table),
			this.whereClause(where, bindings),
			this.returningClause(options.returning),
		]
			.filter(Boolean)
			.join(" ")

		return this.query<T>(sql, bindings)
	}

	transaction<T>(callback: (db: Database) => T | Promise<T>) {
		return this.sql.begin(async (tx) => {
			const database = new Database(tx, {
				dialect: this.dialect,
			})

			return callback(database)
		})
	}

	private selectClause(columns: readonly string[] | undefined) {
		if (!columns || columns.length === 0) {
			return "*"
		}

		return columns.map((column) => this.identifier(column)).join(", ")
	}

	private whereClause(where: Where, values: unknown[]) {
		const entries = Object.entries(where)

		if (entries.length === 0) {
			return ""
		}

		const conditions = entries.map(([column, value]) => {
			const identifier = this.identifier(column)

			if (value === null) {
				return `${identifier} is null`
			}

			if (Array.isArray(value)) {
				if (value.length === 0) {
					return "1 = 0"
				}

				const placeholders = value.map((item) => {
					values.push(item)
					return placeholder(values.length, this.dialect)
				})

				return `${identifier} in (${placeholders.join(", ")})`
			}

			values.push(value)
			return `${identifier} = ${placeholder(values.length, this.dialect)}`
		})

		return `where ${conditions.join(" and ")}`
	}

	private orderByClause(orderBy: OrderBy | readonly OrderBy[] | undefined) {
		if (!orderBy) {
			return ""
		}

		const entries = Array.isArray(orderBy) ? orderBy : [orderBy]

		return `order by ${entries
			.map((entry) => {
				if (typeof entry === "string") {
					return this.identifier(entry)
				}

				return `${this.identifier(entry.column)} ${(entry.direction ?? "asc").toUpperCase()}`
			})
			.join(", ")}`
	}

	private limitClause(limit: number | undefined, offset: number | undefined, values: unknown[]) {
		const normalizedLimit = normalizeLimit("limit", limit)
		const normalizedOffset = normalizeLimit("offset", offset)
		const clauses: string[] = []

		if (normalizedLimit !== undefined) {
			values.push(normalizedLimit)
			clauses.push(`limit ${placeholder(values.length, this.dialect)}`)
		}

		if (normalizedOffset !== undefined) {
			values.push(normalizedOffset)
			clauses.push(`offset ${placeholder(values.length, this.dialect)}`)
		}

		return clauses.join(" ")
	}

	private returningClause(returning: Returning | undefined) {
		if (!returning) {
			return ""
		}

		if (this.dialect === "mysql") {
			throw new Error("MySQL does not support returning clauses")
		}

		if (returning === "*") {
			return "returning *"
		}

		if (returning.length === 0) {
			return ""
		}

		return `returning ${returning.map((column) => this.identifier(column)).join(", ")}`
	}

	private createTableSql(table: string, columns: TableSchema) {
		const definitions = Object.entries(columns).map(([name, definition]) =>
			this.columnDefinitionSql(name, definition),
		)

		if (definitions.length === 0) {
			throw new Error(`Table ${table} must define at least one column`)
		}

		return `create table if not exists ${this.identifier(table)} (${definitions.join(", ")})`
	}

	private columnDefinitionSql(name: string, definition: ColumnDefinition) {
		return this.columnSql(name, definition)
	}

	columnSql(name: string, definition: ColumnDefinition) {
		if (typeof definition === "string") {
			return `${this.identifier(name)} ${definition}`
		}

		const parts = [this.identifier(name)]
		const primaryKeyAutoIncrement = definition.primaryKey && definition.autoIncrement

		if (primaryKeyAutoIncrement && this.dialect === "sqlite") {
			parts.push("integer primary key autoincrement")
		} else if (primaryKeyAutoIncrement && this.dialect === "postgres") {
			parts.push("bigserial primary key")
		} else if (primaryKeyAutoIncrement && this.dialect === "mysql") {
			parts.push("bigint primary key auto_increment")
		} else {
			parts.push(this.columnType(definition.type))

			if (definition.primaryKey) {
				parts.push("primary key")
			}
		}

		if (definition.notNull && !definition.primaryKey) {
			parts.push("not null")
		}

		if (definition.unique) {
			parts.push("unique")
		}

		if (definition.default !== undefined) {
			parts.push("default", this.defaultValue(definition.default))
		}

		if (definition.references) {
			parts.push(this.referenceSql(definition.references))
		}

		return parts.join(" ")
	}

	private columnType(type: ColumnType) {
		switch (type) {
			case "boolean":
				return this.dialect === "sqlite" ? "integer" : "boolean"
			case "json":
				if (this.dialect === "postgres") {
					return "jsonb"
				}

				return this.dialect === "sqlite" ? "text" : "json"
			case "timestamp":
				return this.dialect === "postgres" ? "timestamptz" : "timestamp"
			default:
				return type
		}
	}

	private defaultValue(value: ColumnDefault) {
		if (typeof value === "object" && value !== null && "sql" in value) {
			return value.sql
		}

		if (value === null) {
			return "null"
		}

		if (typeof value === "boolean") {
			return value ? "1" : "0"
		}

		if (typeof value === "number" || typeof value === "bigint") {
			return String(value)
		}

		if (value instanceof Date) {
			return this.stringLiteral(value.toISOString())
		}

		if (value instanceof Uint8Array) {
			throw new Error("Uint8Array defaults are not supported in schema definitions")
		}

		return this.stringLiteral(value)
	}

	private stringLiteral(value: string) {
		return `'${value.replaceAll("'", "''")}'`
	}

	private referenceSql(reference: ColumnReference) {
		if (typeof reference === "string") {
			const [table, column] = reference.split(".")

			if (!table || !column) {
				throw new Error(`Invalid column reference: ${reference}`)
			}

			return `references ${this.identifier(table)} (${this.identifier(column)})`
		}

		const parts = [
			"references",
			this.identifier(reference.table),
			`(${this.identifier(reference.column)})`,
		]

		if (reference.onDelete) {
			parts.push("on delete", reference.onDelete)
		}

		if (reference.onUpdate) {
			parts.push("on update", reference.onUpdate)
		}

		return parts.join(" ")
	}
}
