import { RESULT_EVENT_PREFIX, TASK_EVENT, taskRequestSchema } from "@/lib/page-events";
import { runInsideYouTubePage } from "@/lib/page-task";

export default defineUnlistedScript(() => {
  document.addEventListener(TASK_EVENT, async e => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    const { id, task } = taskRequestSchema.parse(JSON.parse(e.detail));
    const result = await runInsideYouTubePage(task);
    document.dispatchEvent(new CustomEvent(RESULT_EVENT_PREFIX + id, { detail: JSON.stringify(result) }));
  });
});
