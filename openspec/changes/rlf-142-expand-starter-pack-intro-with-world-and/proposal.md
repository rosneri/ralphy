# RLF-142: Expand starter pack intro with world and story overview

Source: [RLF-142](https://linear.app/neriros/issue/RLF-142/expand-starter-pack-intro-with-world-and-story-overview)
Status: In Progress
Labels: Feature

## Why

New users opening Ralphy for the first time see a bare "No tasks yet" empty state with no guidance on what the product does, how the loop works, or what to expect. This leaves users without context to get started effectively.

The starter pack intro addresses this by displaying a world and story overview at the beginning of the intro tour — a rich welcome experience that summarizes what Ralphy is, how the loop works, and invites users into the agent-driven workflow.

## What Changes

- Add a `StarterPackIntro` component to the UI that displays a world/story overview of the Ralphy workflow
- Add world and story overview text as a content template in `packages/content/`
- Expose the intro content via a new `/intro` sidecar API endpoint
- Replace the bare empty state in `TaskListView` with the full intro tour (world overview + call to action)
- Add a `useIntro` hook in the UI that fetches and caches the intro content from the sidecar

## Additional instructions

You are working on RLF-142: Expand starter pack intro with world and story overview.

In the starter pack generate text that summarizes everything in starter pack and intros the user to the game.

Have it displayed in the beginning of the intro tour

Labels: Feature

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
