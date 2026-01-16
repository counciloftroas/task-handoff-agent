# Task Handoff Agent

A collaborative AI agent system that enables multiple Claude users to work together on tasks via GitHub.

## Overview

Task Handoff Agent allows:
- **Agent A** starts a task, makes progress, and stores state in GitHub
- **Agent B** picks up where Agent A left off with full context
- All task state, progress, and conversation history persisted to GitHub

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
DEFAULT_STATE_REPO=your-org/task-handoff-state
```

### 3. Run Development Server

```bash
npm run dev
```

### 4. Start a Task

```bash
# Via CLI
npm run cli -- start \
  --title "Add dark mode" \
  --prompt "Add dark mode toggle to the settings page" \
  --repo "your-org/your-repo"

# Via API
curl -X POST http://localhost:3000/api/agent/start \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add dark mode",
    "description": "Add dark mode toggle to settings",
    "prompt": "Add dark mode toggle to the settings page",
    "github": {
      "repo": "your-org/your-repo",
      "branch": "main"
    }
  }'
```

### 5. Continue a Task (Another Agent)

```bash
# Accept handoff and continue
npm run cli -- continue <task-id> --accept-handoff

# Or via API
curl -X POST http://localhost:3000/api/agent/continue \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "<task-id>",
    "acceptHandoff": true
  }'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agent/start` | POST | Start a new task |
| `/api/agent/continue` | POST | Continue/resume a task |
| `/api/agent/handoff` | POST | Initiate handoff to another agent |
| `/api/agent/status` | GET | Get task status |
| `/api/webhooks/github` | POST | GitHub webhook handler |

## CLI Commands

```bash
task-handoff start [options]     # Start a new task
task-handoff continue <taskId>   # Continue an existing task
task-handoff handoff <taskId>    # Initiate a handoff
task-handoff status [taskId]     # Get task status
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Agent A    │────▶│  Vercel API      │────▶│  GitHub Repo    │
│  (CLI/Web)  │     │  /agent/start    │     │  .task-handoff/ │
└─────────────┘     └──────────────────┘     └─────────────────┘
                            │                        │
                            ▼                        ▼
                    ┌──────────────────┐     ┌─────────────────┐
                    │  Claude (AI SDK) │     │  Task State     │
                    │  Agent Executor  │     │  (JSON files)   │
                    └──────────────────┘     └─────────────────┘
                                                     │
┌─────────────┐     ┌──────────────────┐            │
│  Agent B    │────▶│  Vercel API      │◀───────────┘
│  (CLI/Web)  │     │  /agent/continue │
└─────────────┘     └──────────────────┘
```

## Task State

Task state is stored in GitHub at `.task-handoff/tasks/{task-id}/state.json`:

```json
{
  "id": "uuid",
  "title": "Task name",
  "status": "in_progress",
  "progress": {
    "currentPhase": "implementation",
    "percentComplete": 45
  },
  "nextSteps": {
    "immediate": ["Complete feature X", "Write tests"],
    "blockers": []
  },
  "handoffs": [...]
}
```

## Deploy to Vercel

```bash
# Link to Vercel
vercel link

# Set secrets
vercel secrets add anthropic-api-key "sk-ant-..."
vercel secrets add github-token "ghp_..."

# Deploy
vercel --prod
```

## License

MIT
