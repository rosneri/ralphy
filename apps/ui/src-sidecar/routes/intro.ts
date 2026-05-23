import { getStarterPackIntro } from "@ralphy/content/intro";

interface RouteResult {
  status: number;
  body: unknown;
}

export function introRoutes(_req: Request): RouteResult {
  return { status: 200, body: getStarterPackIntro() };
}
