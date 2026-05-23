export interface StarterPackIntroContent {
  title: string;
  world: string;
  story: string;
}

export function getStarterPackIntro(): StarterPackIntroContent {
  return {
    title: "Welcome to Ralphy",
    world:
      "Ralphy is an agentic loop framework that drives AI assistants through multi-step engineering tasks. Each task has a proposal, a design, and a checklist of specs. The loop iterates until all boxes are checked — or until you stop it.",
    story:
      "Start by creating a task. Describe what you want built, then let Ralphy's loop run the implementation step by step. You can steer it mid-flight, inspect every iteration, and pick up where it left off. Think of it as a junior engineer that never sleeps — you just have to point it in the right direction.",
  };
}
