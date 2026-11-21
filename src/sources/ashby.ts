import { z } from "zod";
import { jobBoardSource, toIso } from "./job-board.js";

const Response = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      jobUrl: z.string(),
      department: z.string().nullish(),
      team: z.string().nullish(),
      location: z.string().nullish(),
      publishedAt: z.string().nullish(),
      isListed: z.boolean().nullish(),
    }),
  ),
});

export const ashbySource = jobBoardSource({
  info: {
    id: "ashby",
    name: "Ashby job boards",
    homepage: "https://developers.ashbyhq.com/docs/public-job-posting-api",
    rateLimit: "Public and unauthenticated, no documented limit. One request per company.",
    gives: ["hiring"],
  },
  platform: "ashby",
  boardUrl: (slug) => `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`,
  apiUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
  schema: Response,
  postings: (response) =>
    response.jobs
      // Unlisted roles are reachable by direct link only. The company chose
      // not to advertise them, so we do not report them.
      .filter((job) => job.isListed !== false)
      .map((job) => ({
        title: job.title,
        url: job.jobUrl,
        team: [job.department, job.team].filter((part) => part != null).join(" "),
        location: job.location ?? undefined,
        postedAt: toIso(job.publishedAt),
      })),
});
