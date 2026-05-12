import { useApi, useForm } from "@puppycorp/pstack/react"
import { api } from "./api"
import "./index.css"

export function App() {
	const todos = useApi(api.todos.list, undefined)
	const createTodo = useApi(api.todos.create)
	const toggleTodo = useApi(api.todos.toggle)
	const form = useForm(api.todos.create, {
		defaultValues: {
			title: "",
		},
	})

	return (
		<div className="app">
			<h1>PuppyTodo</h1>
			<p>Keep the pack on track with tiny typed tasks.</p>

			<section className="todo-panel">
				<form
					className="todo-form"
					onSubmit={form.submit(async (input) => {
						await createTodo.mutate(input)
						await todos.refetch()
					})}
				>
					<input
						{...form.field("title")}
						className="todo-input"
						placeholder="Add a todo"
					/>
					<button
						type="submit"
						className="todo-button"
						disabled={!form.valid || createTodo.loading}
					>
						{createTodo.loading ? "Adding..." : "Add"}
					</button>
				</form>

				{form.error("title") && <p className="field-error">{form.error("title")}</p>}

				{todos.loading && <p className="todo-status">Loading todos...</p>}
				{Boolean(todos.error) && <p className="field-error">Could not load todos.</p>}
				{Boolean(createTodo.error) && <p className="field-error">Could not create todo.</p>}

				<ul className="todo-list">
					{(todos.data ?? []).map((todo) => (
						<li key={todo.id} className="todo-item">
							<label className="todo-label">
								<input
									type="checkbox"
									checked={todo.completed}
									disabled={toggleTodo.loading}
									onChange={async (event) => {
										await toggleTodo.mutate({
											id: todo.id,
											completed: event.currentTarget.checked,
										})
										await todos.refetch()
									}}
								/>
								<span className={todo.completed ? "completed" : undefined}>
									{todo.title}
								</span>
							</label>
						</li>
					))}
				</ul>
			</section>
		</div>
	)
}

export default App
