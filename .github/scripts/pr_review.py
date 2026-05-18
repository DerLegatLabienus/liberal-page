#!/usr/bin/env python3
"""Claude PR reviewer — called by pr-review.yml."""
import anthropic
import os
import sys


def main():
    diff_path = "/tmp/diff.txt"
    claude_md_path = "CLAUDE.md"

    try:
        diff = open(diff_path).read()
    except FileNotFoundError:
        print("No diff file found at /tmp/diff.txt", file=sys.stderr)
        sys.exit(1)

    try:
        claude_md = open(claude_md_path).read()
    except FileNotFoundError:
        claude_md = "(CLAUDE.md not found)"

    if len(diff) > 12000:
        diff = diff[:12000] + "\n\n... (diff truncated)"

    if not diff.strip():
        print("Empty diff — nothing to review.")
        return

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    system = f"""You are reviewing a pull request for the Liberals in Likud (הליברלים בליכוד) website — a Hebrew/RTL React 18 + TypeScript + Vite site with an Express backend that tracks Knesset legislation.

Project conventions (from CLAUDE.md):
{claude_md}

Review the diff for:
- Correctness and bugs
- TypeScript type safety
- RTL/Hebrew content handling
- Test coverage gaps
- Adherence to project conventions

Structure your response as:

**Summary:** one sentence.

**Critical (must fix):** list issues that would break functionality or introduce bugs. If none, write "None."

**Important (should fix):** list issues that affect quality or maintainability. If none, write "None."

Skip minor style nits. Be concise."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=[
            {
                "role": "user",
                "content": f"Review this diff:\n\n```diff\n{diff}\n```",
            }
        ],
    )

    print(response.content[0].text)


if __name__ == "__main__":
    main()
