<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Lessons from customer bugs

Every new feature or bug fix comes with a test in `tests/` that fails without the change, and `npm test` must pass before the work is called done. Prefer fast Vitest tests of the logic over browser tests.

Before finishing any change, read `LESSONS.md` and go through the questions that touch the change. They are questions from past bugs, not fixed rules: skip what does not apply, and stop and ask if one would break something else.
