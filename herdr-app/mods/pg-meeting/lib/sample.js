// Sample data for `herdr-app check` on a scratch copy. The live mod never reads it unless
// FORCE_SAMPLE in main.js is true. Shapes match `ops-tasks callsheet show --json`.
export const SAMPLE_SESSIONS = [
  { id: 9001, name: "[ACME] Directed Effort Sync", project_name: "Acme Level Up", starts_at: new Date(Date.now() - 23 * 60000).toISOString(), live: true, submitted: false },
  { id: 9002, name: "[ACME] Office Hours", project_name: "Acme Level Up", starts_at: new Date(Date.now() + 90 * 60000).toISOString(), live: false, submitted: false },
];

export function sampleSheet() {
  const start = new Date(Date.now() - 23 * 60000);
  return {
    session: { id: "9001", name: "[ACME] Directed Effort Sync", project_name: "Acme Level Up", customer: "Acme", meeting_type: "Directed Effort Sync", starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 30 * 60000).toISOString() },
    groups: [
      { name: "Open", total: 2, done: 1, missed: 0, na: 0, points: [
        { id: 1, meeting_type_point_id: null, label: "Named this meeting, where it sits, and what comes next", full_label: "Named this meeting, where it sits, and what comes next", result: "done", note: "" },
        { id: 2, meeting_type_point_id: null, label: "Confirmed who owns the DE on their side", full_label: "Confirmed who owns the DE on their side", result: null, note: "Priya, with Sam as backup" },
      ] },
      { name: "Work", total: 3, done: 0, missed: 1, na: 1, points: [
        { id: 3, meeting_type_point_id: null, label: "Reviewed last week's commitments one by one", full_label: "Reviewed last week's commitments one by one", result: "missed", note: "" },
        { id: 4, meeting_type_point_id: null, label: "Demoed the starter skill against a real ticket", full_label: "Demoed the starter skill against a real ticket", result: null, note: "" },
        { id: 5, meeting_type_point_id: null, label: "Asked for the metric they will report", full_label: "Asked for the metric they will report", result: "na", note: "" },
      ] },
    ],
    follow_up_instructions: "",
    call_feedback: "",
    scratchpad: "### Goals\n- Agree the DE scope\n- Pick the first ticket\n\n### Questions\n- Who signs off on the skill?\n- Is the staging repo ready?\n\nIf time: show the review checklist.",
    rating: null,
    version: "sample-1",
    status: "draft",
    submitted: false,
  };
}
