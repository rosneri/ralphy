# Spec: Starter Pack Intro with World and Story Overview

## ADDED Requirements

### Requirement: The UI MUST display an intro tour when no tasks exist

When the task list is empty and loading is complete, the `TaskListView` MUST render a `StarterPackIntro` component instead of the bare "No tasks yet" message. The component MUST display a world overview and a story/narrative overview, and MUST include a call-to-action linking to `/tasks/new`.

#### Scenario: First-time user sees world and story overview

- **Given** the user opens Ralphy with no tasks created
- **When** the task list finishes loading with zero tasks
- **Then** the `StarterPackIntro` component is rendered
- **And** a world overview section is displayed describing what Ralphy is
- **And** a story section is displayed describing the agent-driven loop workflow
- **And** a "Create your first task" call-to-action button is present linking to `/tasks/new`

#### Scenario: Intro is hidden when tasks exist

- **Given** the user has at least one task
- **When** the task list loads
- **Then** `StarterPackIntro` is NOT rendered
- **And** the normal task table is displayed

### Requirement: The sidecar MUST expose GET /intro returning structured intro content

A new `GET /intro` endpoint MUST be registered on the sidecar server. It MUST return HTTP 200 with a JSON body of shape `{ title: string, world: string, story: string }` where all fields are non-empty strings sourced from `@ralphy/content`.

#### Scenario: GET /intro returns structured content

- **Given** the sidecar server is running
- **When** a client sends `GET /intro`
- **Then** the response status is 200
- **And** the body has non-empty string fields `title`, `world`, and `story`

### Requirement: The content package MUST export getStarterPackIntro()

`packages/content/src/intro.ts` MUST export a `getStarterPackIntro()` function returning `StarterPackIntroContent` with non-empty `title`, `world`, and `story` string fields. This function MUST be synchronous and have no external dependencies.

#### Scenario: getStarterPackIntro returns valid content

- **Given** the `@ralphy/content` package is imported
- **When** `getStarterPackIntro()` is called
- **Then** it returns an object where `title`, `world`, and `story` are all non-empty strings
