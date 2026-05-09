import { createStore } from "./store";

type State = {
  screen: "home" | "settings";
  count: number;
};

const store = createStore<State>({
  screen: "home",
  count: 0,
});

function TypeExamples() {
  const screen = store.use(state => state.screen);

  store.set({ screen: "settings" });

  // @ts-expect-error invalid screen value
  store.set({ screen: "bad" });

  // @ts-expect-error selected field is a string
  screen.toFixed(2);

  return screen;
}

void TypeExamples;
