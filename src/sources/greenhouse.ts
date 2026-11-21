import { z } from "zod";
import { jobBoardSource, toIso } from "./job-board.js";

const Response = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      first_published: z.string().nullish(),
      updated_at: z.string().nullish(),
    }),
  ),
});

export const greenhouseSource = jobBoardSource({
  info: {
    id: "greenhouse",
    name: "Greenhouse job boards",
    homepage: "https://developers.greenhouse.io/job-board.html",
    rateLimit: "Public and unauthenticated, no documented limit. One request per company.",
    gives: ["hiring"],
  },
  platform: "greenhouse",
  boardUrl: (slug) => `https://boards.greenhouse.io/${encodeURIComponent(slug)}`,
  apiUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
  schema: Response,
  postings: (response) =>
    response.jobs.map((job) => ({
      title: job.title,
      url: job.absolute_url,
      location: job.location?.name ?? undefined,
      postedAt: toIso(job.first_published ?? job.updated_at),
    })),
});
