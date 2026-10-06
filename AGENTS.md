<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Lessons from customer bugs

Every new feature or bug fix comes with a test in `tests/` that fails without the change, and `npm test` must pass before the work is called done. Prefer fast Vitest tests of the logic over browser tests.

Before finishing any change, read `LESSONS.md` and go through the questions that touch the change. They are questions from past bugs, not fixed rules: skip what does not apply, and stop and ask if one would break something else.

Every customer bug fix also adds its question to `LESSONS.md` (date and customer) in the same commit, unless one already covers it. Fixed bugs that never reached the file were made again.

# Three places

A change can show up in three places: the seller page (browser till), the admin page, and the exe. Before calling work done:

- Search for every screen that shows the same number, label, list or status, and change them all together.
- Keep each calculation in one function in `lib/`, used by every screen, with a test that fails if a screen counts on its own.
- Say which of the three changed, which did not, and why.

# The exe

The Windows exe always carries its own copy of the page. The `url` in the build (Actions → Desktop (Windows) → Run workflow) only picks which server it talks to; it does not load the page from that site. So every change, page or exe code, needs a new exe build before it can be tested in the exe. Only the browser terminal link picks up a push without a build.
