---
inclusion: always
---

# Workflow Control

## Purpose

This steering document defines when and how to use workflows in BioCore development. Workflows are powerful but introduce complexity—use them intentionally.

## Default Behavior

**Unless explicitly instructed, DO NOT launch workflows.** Operate manually with direct tool use:

- Read and edit files directly
- Execute commands manually
- Analyze code with targeted tool calls
- Make decisions incrementally

## When to Launch Workflows

Launch a workflow **only** when:

1. You explicitly ask for one using phrases like "use a workflow to..." or "launch a workflow..."
2. The task is specifically about workflow management (monitoring, editing, creating workflows)

## When NOT to Use Workflows

Avoid workflows for:

- Simple file edits or small refactorings
- One-off tasks that don't repeat
- Debugging sessions requiring iteration
- Quick explorations of codebase structure

## Switching Modes

To enable automatic workflow delegation, edit this file and set the state to "Inactive".

## Best Practices

- **Prefer direct control** for precision and visibility
- **Use workflows** for repetitive, well-defined multi-step processes
- **Document workflow purpose** clearly when creating new ones
- **Prefer existing workflows** over creating new ones unless necessary
