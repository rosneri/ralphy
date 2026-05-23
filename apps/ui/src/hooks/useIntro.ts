import { useState, useEffect } from "react";
import { useSidecar } from "../context/Sidecar.context";

interface IntroContent {
  title: string;
  world: string;
  story: string;
}

const FALLBACK: IntroContent = {
  title: "Welcome to Ralphy",
  world:
    "Ralphy is an agentic loop framework that drives AI assistants through multi-step engineering tasks.",
  story: "Start by creating a task and let Ralphy's loop run the implementation step by step.",
};

export function useIntro() {
  const { baseUrl, connected } = useSidecar();
  const [intro, setIntro] = useState<IntroContent>(FALLBACK);

  useEffect(() => {
    if (!connected) return;
    fetch(`${baseUrl}/intro`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: IntroContent) => setIntro(data))
      .catch(() => setIntro(FALLBACK));
  }, [baseUrl, connected]);

  return intro;
}
