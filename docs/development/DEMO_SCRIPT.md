# Demo walkthrough

All people and cases are fictional. Use the shared demo password `demo1234`. This walkthrough covers role handoffs, deadline behavior, assignment explanations, audit checks, and rule changes.

1. Sign in as `college.abc@demo.in`. Start a new institution application. Enter a built-up area larger than the land area; the form check should flag it. Correct the value, attach the land lease, and submit. The case should be assigned to the institution's portfolio officer.
2. Sign in as `priya@demo.in`. Open the case, return it to the college with a reason, and request the missing lease validity. The stage clock pauses while the college holds the case.
3. Sign in as the college and reply with a corrected lease. The case returns to the officer with its remaining time.
4. Complete scrutiny and inspect the EVC desk task's assignment explanation.
5. Sign in as admin and advance the demo date. Check that overdue tasks create alerts and escalations.
6. As a manager, inspect team and workforce views. Add leave for an officer and review the reassignment reasons.
7. As the EVC desk officer, schedule the committee review. Submit a committee report and follow the case to the decision queue.
8. As `authority.south@demo.in`, approve with conditions and a fire NOC undertaking.
9. Advance the demo date to the undertaking reminder window. As the college, upload the NOC; as the officer, verify it and close the case.
10. As admin, verify audit integrity and inspect the audit trail. For the tamper demonstration, use `npm run demo:tamper` only against disposable local demo data.
11. Sign in as `rules.editor@demo.in` and draft an amendment. Submit it for review; sign in as `rules.approver@demo.in` to approve and publish. Verify that substantive rules remain pinned for filed cases, while the operational schedule follows the published version.

Rules, timelines, task assignments, and application data are placeholders for the prototype. Reset the demo with `npm run demo:reset` before repeating the walkthrough. That command discards demo changes.
