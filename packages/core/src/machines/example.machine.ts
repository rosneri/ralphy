import { setup } from "xstate";

export const exampleMachine = setup({
  types: {} as {
    events: { type: "START" } | { type: "STOP" };
  },
}).createMachine({
  id: "example",
  initial: "idle",
  states: {
    idle: { on: { START: "active" } },
    active: { on: { STOP: "idle" } },
  },
});
